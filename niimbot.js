// Printer layer built on niimbluelib (the library behind niim.blue).
// lib/niimbluelib.min.js is loaded as a global script: window.niimbluelib
const NB = window.niimbluelib;

const hex = (a) => Array.from(a || [], (b) => b.toString(16).padStart(2, "0")).join(" ");

export class Niimbot {
  constructor(log = console.log) {
    this.log = log;
    this.client = null;
    this.onDisconnect = null;
    this.deviceName = null;
    this.debug = true;
  }

  static supported(kind = "usb") {
    if (!NB) return false;
    return kind === "usb" ? !!navigator.serial : !!navigator.bluetooth;
  }

  get connected() {
    return !!(this.client && this.client.isConnected());
  }

  /** Model info: {model, dpi, head, densityMin, densityMax, density, task, direction} */
  get info() {
    const m = this.client?.getModelMetadata();
    const pi = this.client?.getPrinterInfo() || {};
    return {
      model: m?.model || "?",
      dpi: m?.dpi || 203,
      head: m?.printheadPixels || pi.printheadWidth || 96,
      densityMin: m?.densityMin || 1,
      densityMax: m?.densityMax || 3,
      density: m?.densityDefault || 2,
      direction: m?.printDirection || "left",
      task: this.client?.getPrintTaskType() || "?",
      battery: pi.batteryPercents,
      protocol: pi.protocolVersion,
    };
  }

  /** kind: "usb" (cable, Web Serial) or "ble" (Bluetooth) */
  async connect(kind = "usb", port = null) {
    if (this.client) { try { await this.client.disconnect(); } catch {} }
    const client = kind === "usb" ? new NB.NiimbotSerialClient() : new NB.NiimbotBluetoothClient();
    this.kind = kind;
    client.on("disconnect", () => { this.onDisconnect && this.onDisconnect(); });
    client.on("packetsent", (e) => {
      const c = e.packet.command;
      if (this.debug && c !== 0x85 && c !== 0x84 && c !== 0x83 && c !== 0xdc) this.log(`→ ${hex([c])}: ${hex(e.packet.data)}`);
    });
    client.on("packetreceived", (e) => {
      const c = e.packet.command;
      if (this.debug && c !== 0xdd && c !== 0xde && c !== 0xdf && c !== 0xd9) this.log(`  ← ${hex([c])}: ${hex(e.packet.data)}`);
    });
    const res = await client.connect(kind === "usb" && port ? { authorizedPort: port } : undefined);
    this.client = client;
    this.deviceName = kind === "usb" ? `${client.getModelMetadata()?.model || "NIIMBOT"} (USB)` : (res.deviceName || "NIIMBOT");
    client.startHeartbeat();
    const i = this.info;
    this.log(`Connected: ${this.deviceName} — model ${i.model}, DPI ${i.dpi}, head ${i.head}px, protocol ${i.protocol}, print task ${i.task}`);
    return this.deviceName;
  }

  async disconnect() {
    if (this.client) await this.client.disconnect();
  }

  async getBattery() {
    return this.client?.getPrinterInfo()?.batteryPercents ?? null;
  }

  /**
   * Print canvases (each canvas = one label, landscape, height = printable width in px).
   * @param {HTMLCanvasElement[]} canvases
   */
  async printCanvases(canvases, { density = 3, flip = false, labelType = 1 } = {}, onProgress) {
    const client = this.client;
    const info = this.info;
    const taskName = client.getPrintTaskType() ?? "D110";
    const total = canvases.length;

    const encoded = canvases.map((cv) => {
      let src = cv;
      if (flip) {
        src = document.createElement("canvas");
        src.width = cv.width; src.height = cv.height;
        const c = src.getContext("2d");
        c.translate(cv.width, cv.height); c.rotate(Math.PI); c.drawImage(cv, 0, 0);
      }
      return NB.ImageEncoder.encodeCanvas(src, NB.PageColorType?.SingleColor ?? 0, info.direction);
    });
    this.log(`Printing ${total} label(s) with task ${taskName} — ${encoded[0].cols}×${encoded[0].rows}px, density ${density}`);

    const onProg = (e) => onProgress && onProgress(
      Math.min(1, ((e.page - 1) + (e.pagePrintProgress + e.pageFeedProgress) / 200) / total), e.page, total);
    client.on("printprogress", onProg);
    client.stopHeartbeat();

    const task = client.protocol.newPrintTask(taskName, {
      totalPages: total,
      density,
      labelType,
      statusPollIntervalMs: 200,
      statusTimeoutMs: 10000,
    });
    try {
      await task.printInit();
      for (const img of encoded) {
        await task.printPage(img, 1);
        await task.waitForPageFinished();
      }
      await task.waitForFinished();
    } finally {
      try { await task.printEnd(); } catch (e) { this.log("printEnd: " + e.message); }
      client.off("printprogress", onProg);
      client.startHeartbeat();
    }
  }
}
