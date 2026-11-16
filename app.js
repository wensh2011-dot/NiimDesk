import { Niimbot } from "./niimbot.js?v=10";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 9);
const deep = (o) => JSON.parse(JSON.stringify(o));

// ============================================================ constants
const LABEL_SIZES = [
  [40, 12], [40, 14], [40, 15], [40, 20], [30, 12], [30, 14], [30, 15], [30, 10], [25, 10],
  [50, 12], [50, 14], [50, 15], [35, 13], [33, 14], [70, 13], [70, 14], [22, 12], [75, 12], [109, 12],
];
const FONTS = [
  "Arial", "Tahoma", "Segoe UI", "Calibri", "Times New Roman", "Courier New", "Verdana", "Impact",
  "Traditional Arabic", "Simplified Arabic", "Arabic Typesetting", "Sakkal Majalla", "Aldhabi", "Andalus",
];
const ICONS = "★☆♥♡✓✔✗✘⚠☢☣♻⚡☀☁☂❄☃☎✉✂✈⌂☕♨⚓⚽♪♫☺☹✿❀✪➜⬅⬆⬇↻⌚⏰⚙⚑☘♛♚".split("");
const BARCODE_FORMATS = ["CODE128", "EAN13", "EAN8", "UPC", "CODE39", "ITF14", "codabar"];
const SCREEN_PX_PER_MM = 12;
const SNAP_MM = 0.8;

// ============================================================ state
let settings = loadJSON("ls.settings", { dpi: 203, head: 96, task: "v1", densityMax: 3, density: 2, flip: false, model: "" });
let project = loadProject();
let doc = project.pages[project.cur];
let batch = loadJSON("ls.batch", null); // {file, cols, rows, cur}
let selId = null;
let zoom = 1;
let printPreview = false;
let history = [JSON.stringify(project)], hIndex = 0;
let clipboard = null;
const imgCache = new Map();
const printer = new Niimbot(log);

function newDoc(w, h) {
  return {
    w, h,
    elements: [{ id: uid(), type: "text", x: 2, y: 1, w: w - 4, h: h - 2, rot: 0, locked: false,
                 text: "اضغط مرتين للتعديل", font: "Arial", size: 4, bold: true, italic: false,
                 underline: false, align: "center", fit: true, invert: false, spacing: 1.1 }],
  };
}

function loadProject() {
  const p = loadJSON("ls.project", null);
  if (p && Array.isArray(p.pages) && p.pages.length) { p.cur = clamp(p.cur || 0, 0, p.pages.length - 1); return p; }
  const d = loadJSON("ls.current", null) || newDoc(40, 12);
  return { pages: [d], cur: 0 };
}
function toProject(d) {
  if (d && Array.isArray(d.pages)) return { pages: deep(d.pages), cur: 0, name: d.name };
  return { pages: [deep(d)], cur: 0, name: d.name };
}

function loadJSON(k, def) {
  try { const v = localStorage.getItem(k); return v ? { ...(def || {}), ...JSON.parse(v) } : def; }
  catch { return def; }
}
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

const dpm = () => settings.dpi / 25.4;
const maxLabelH = () => Math.floor((settings.head / dpm()) * 10) / 10;
const sel = () => doc.elements.find((e) => e.id === selId);

// ============================================================ history
function commit() {
  const s = JSON.stringify(project);
  if (s === history[hIndex]) return;
  history = history.slice(0, hIndex + 1);
  history.push(s);
  if (history.length > 100) history.shift();
  hIndex = history.length - 1;
  saveJSON("ls.project", project);
  updateToolbar();
}
function undo() { if (hIndex > 0) { project = JSON.parse(history[--hIndex]); afterHistory(); } }
function redo() { if (hIndex < history.length - 1) { project = JSON.parse(history[++hIndex]); afterHistory(); } }
function afterHistory() {
  project.cur = clamp(project.cur, 0, project.pages.length - 1);
  doc = project.pages[project.cur];
  if (!sel()) selId = null;
  saveJSON("ls.project", project);
  syncSize(); render(); buildProps(); updateToolbar(); renderPagesBar();
}

// ============================================================ text helpers
function expandText(t, ctx = {}) {
  const now = new Date();
  if (ctx.row) t = String(t ?? "").replace(/\{([^{}]+)\}/g, (m, k) => (k in ctx.row ? String(ctx.row[k] ?? "") : m));
  const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return String(t ?? "")
    .replace(/\{date([+-]\d+)?\}/g, (_, off) => { const d = new Date(now); d.setDate(d.getDate() + (+off || 0)); return fmt(d); })
    .replace(/\{time\}/g, `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`)
    .replace(/\{n(?::(\d+))?\}/g, (_, pad) => String(ctx.serial ?? 1).padStart(+pad || 0, "0"));
}
const isRTL = (s) => /[֐-ࣿיִ-ﻼ]/.test(s);

function fontStr(el, px) {
  return `${el.italic ? "italic " : ""}${el.bold ? "bold " : ""}${px}px "${el.font}", "Segoe UI Symbol", sans-serif`;
}

function drawTextBlock(c, el, text, w, h, s) {
  const lines = text.split("\n");
  let px = el.size * s;
  const sp = el.spacing || 1.1;
  c.letterSpacing = `${(el.letter || 0) * s}px`;
  const measure = (p) => {
    c.font = fontStr(el, p);
    return { mw: Math.max(...lines.map((l) => c.measureText(l).width)), mh: lines.length * p * sp };
  };
  if (el.fit) {
    let lo = 2, hi = h * 2;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2, m = measure(mid);
      if (m.mw <= w && m.mh <= h) lo = mid; else hi = mid;
    }
    px = lo;
  }
  c.font = fontStr(el, px);
  c.textBaseline = "middle";
  const lh = px * sp;
  const startY = h / 2 - (lines.length * lh) / 2 + lh / 2;
  lines.forEach((ln, i) => {
    c.direction = isRTL(ln) ? "rtl" : "ltr";
    const tw = c.measureText(ln).width;
    let x = el.align === "left" ? 0 : el.align === "right" ? w - tw : (w - tw) / 2;
    c.textAlign = "left";
    c.direction = "ltr";
    if (isRTL(ln)) { c.direction = "rtl"; c.textAlign = "right"; x += tw; }
    const y = startY + i * lh;
    c.fillText(ln, x - (c.textAlign === "right" ? 0 : 0), y);
    if (el.underline) {
      const ux = c.textAlign === "right" ? x - tw : x;
      c.fillRect(ux, y + px * 0.42, tw, Math.max(1, px * 0.06));
    }
    if (el.strike) {
      const sx = c.textAlign === "right" ? x - tw : x;
      c.fillRect(sx - px * 0.05, y - px * 0.02, tw + px * 0.1, Math.max(1, px * 0.08));
    }
  });
  return px / s;
}

// ============================================================ rendering
function getImage(src) {
  if (!imgCache.has(src)) {
    const im = new Image();
    im.onload = () => render();
    im.src = src;
    imgCache.set(src, im);
  }
  const im = imgCache.get(src);
  return im.complete && im.naturalWidth ? im : null;
}

function ditherImage(img, w, h, threshold, dither) {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h));
  const c = cv.getContext("2d");
  c.fillStyle = "#fff"; c.fillRect(0, 0, cv.width, cv.height);
  c.drawImage(img, 0, 0, cv.width, cv.height);
  const d = c.getImageData(0, 0, cv.width, cv.height), p = d.data;
  const W = cv.width, H = cv.height, g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = p[i * 4] * 0.299 + p[i * 4 + 1] * 0.587 + p[i * 4 + 2] * 0.114;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, old = g[i], nw = old < threshold ? 0 : 255, err = old - nw;
    g[i] = nw;
    if (dither) {
      if (x + 1 < W) g[i + 1] += err * 7 / 16;
      if (y + 1 < H) { if (x > 0) g[i + W - 1] += err * 3 / 16; g[i + W] += err * 5 / 16; if (x + 1 < W) g[i + W + 1] += err / 16; }
    }
  }
  for (let i = 0; i < W * H; i++) { p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = g[i]; p[i * 4 + 3] = 255; }
  c.putImageData(d, 0, 0);
  return cv;
}

function drawElement(c, el, s, ctx) {
  const rot = ((el.rot || 0) % 360 + 360) % 360;
  const sw = rot % 180 ? el.h : el.w, sh = rot % 180 ? el.w : el.h; // local (unrotated) size
  const W = sw * s, H = sh * s;
  c.save();
  c.translate((el.x + el.w / 2) * s, (el.y + el.h / 2) * s);
  c.rotate((rot * Math.PI) / 180);
  c.translate(-W / 2, -H / 2);
  c.fillStyle = "#000"; c.strokeStyle = "#000";

  switch (el.type) {
    case "text": {
      if (el.invert) { c.fillRect(0, 0, W, H); c.fillStyle = "#fff"; }
      const pad = el.invert ? 0.6 * s : 0;
      c.translate(pad, 0);
      el._px = drawTextBlock(c, el, expandText(el.text, ctx), W - pad * 2, H, s);
      break;
    }
    case "icon": {
      c.font = `${H * 0.95}px "Segoe UI Symbol", "Segoe UI Emoji"`;
      c.textAlign = "center"; c.textBaseline = "middle";
      const m = c.measureText(el.char);
      const scale = Math.min(1, W / (m.width || 1));
      c.font = `${H * 0.95 * scale}px "Segoe UI Symbol", "Segoe UI Emoji"`;
      c.fillText(el.char, W / 2, H / 2 + H * 0.04);
      break;
    }
    case "rect": {
      const t = Math.max(1, el.thick * s), r = Math.min(el.radius * s, W / 2, H / 2);
      c.lineWidth = t;
      c.beginPath();
      c.roundRect(t / 2, t / 2, W - t, H - t, Math.max(0, r - t / 2));
      if (el.fill) c.fill(); else c.stroke();
      break;
    }
    case "line": {
      const t = Math.max(1, el.thick * s);
      c.lineWidth = t;
      if (el.dash) c.setLineDash([t * 3, t * 2]);
      c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
      break;
    }
    case "table": {
      const t = Math.max(1, el.thick * s);
      c.lineWidth = t;
      const rows = el.rows, cols = el.cols;
      const cw = (W - t) / cols, ch = (H - t) / rows;
      c.strokeRect(t / 2, t / 2, W - t, H - t);
      c.beginPath();
      for (let i = 1; i < rows; i++) { c.moveTo(0, t / 2 + i * ch); c.lineTo(W, t / 2 + i * ch); }
      for (let j = 1; j < cols; j++) { c.moveTo(t / 2 + j * cw, 0); c.lineTo(t / 2 + j * cw, H); }
      c.stroke();
      const cells = String(el.cells || "").split("\n").map((r) => r.split("|"));
      const cellEl = { font: el.font, bold: el.bold, size: el.size, fit: true, align: "center", spacing: 1.05 };
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const txt = expandText((cells[i] || [])[j] || "", ctx).trim();
        if (!txt) continue;
        c.save();
        // RTL table: first column on the right
        const col = el.rtl ? cols - 1 - j : j;
        c.translate(t + col * cw + cw * 0.08, t + i * ch);
        drawTextBlock(c, cellEl, txt, cw * 0.84 - t, ch - t, s);
        c.restore();
      }
      break;
    }
    case "qr": {
      try {
        qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
        const q = qrcode(0, el.ecc || "M");
        q.addData(expandText(el.data, ctx) || " ");
        q.make();
        const n = q.getModuleCount();
        const size = Math.min(W, H);
        const mod = Math.max(1, Math.floor(size / n)) ;
        const real = s === ctx.printScale ? mod * n : size; // crisp integer modules when printing
        const m = real / n;
        const ox = (W - real) / 2, oy = (H - real) / 2;
        for (let r = 0; r < n; r++) for (let k = 0; k < n; k++)
          if (q.isDark(r, k)) c.fillRect(ox + k * m, oy + r * m, m + 0.02, m + 0.02);
      } catch (e) { drawError(c, W, H, s, "QR طويل"); }
      break;
    }
    case "barcode": {
      try {
        const data = expandText(el.data, ctx);
        const tmp = document.createElement("canvas");
        const textPx = el.showText ? Math.max(8, el.textSize * s) : 0;
        const opts = { format: el.format, displayValue: false, margin: 0, width: 1, height: 10, background: "#fff", lineColor: "#000" };
        JsBarcode(tmp, data, opts);
        const modules = tmp.width;
        const mw = Math.max(1, Math.floor(W / modules));
        const barsW = s === ctx.printScale ? modules * mw : Math.min(W, modules * Math.max(mw, W / modules));
        const barH = Math.max(4, H - (el.showText ? textPx * 1.15 : 0));
        c.imageSmoothingEnabled = false;
        c.drawImage(tmp, 0, 0, modules, 1, (W - barsW) / 2, 0, barsW, barH);
        if (el.showText) {
          c.font = `${textPx}px Arial`; c.textAlign = "center"; c.textBaseline = "bottom";
          c.fillText(data, W / 2, H);
        }
      } catch (e) { drawError(c, W, H, s, "بيانات الباركود غير صالحة"); }
      break;
    }
    case "image": {
      const im = getImage(el.src);
      if (!im) break;
      const r = Math.min(W / im.naturalWidth, H / im.naturalHeight);
      const dw = im.naturalWidth * r, dh = im.naturalHeight * r;
      const bw = ditherImage(im, dw, dh, el.threshold ?? 128, !!el.dither);
      c.imageSmoothingEnabled = false;
      if (el.invert) c.filter = "invert(1)";
      c.drawImage(bw, (W - dw) / 2, (H - dh) / 2, dw, dh);
      c.filter = "none";
      break;
    }
  }
  c.restore();
}

function drawError(c, W, H, s, msg) {
  c.strokeStyle = "#e5484d"; c.lineWidth = 1; c.setLineDash([3, 3]); c.strokeRect(0.5, 0.5, W - 1, H - 1);
  c.fillStyle = "#e5484d"; c.font = `${Math.min(H / 3, 2.5 * s)}px Tahoma`;
  c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(msg, W / 2, H / 2);
}

function renderTo(canvas, s, ctx = {}, page = doc) {
  canvas.width = Math.round(page.w * s);
  canvas.height = Math.round(page.h * s);
  const c = canvas.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  for (const el of page.elements) drawElement(c, el, s, ctx);
  return canvas;
}

function threshold(canvas) {
  const c = canvas.getContext("2d");
  const d = c.getImageData(0, 0, canvas.width, canvas.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const v = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114 < 128 ? 0 : 255;
    p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
  }
  c.putImageData(d, 0, 0);
}

const view = $("view"), overlay = $("overlay"), wrap = $("labelWrap");

function screenScale() { return SCREEN_PX_PER_MM * zoom; }

function render() {
  const s = screenScale();
  const cssW = doc.w * s, cssH = doc.h * s;
  if (printPreview) {
    renderTo(view, dpm(), { printScale: dpm(), row: batchRow() });
    threshold(view);
  } else {
    renderTo(view, s * devicePixelRatio, { row: batchRow() });
  }
  view.style.width = cssW + "px"; view.style.height = cssH + "px";
  wrap.classList.toggle("pixelated", printPreview);
  overlay.width = cssW * devicePixelRatio; overlay.height = cssH * devicePixelRatio;
  overlay.style.width = cssW + "px"; overlay.style.height = cssH + "px";
  $("ruler").textContent = `${doc.w} × ${doc.h} مم`;
  drawOverlay();
  renderBatchBar();
}

let guides = [];
function drawOverlay() {
  const s = screenScale(), c = overlay.getContext("2d");
  c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  c.clearRect(0, 0, overlay.width, overlay.height);
  // guides
  c.strokeStyle = "#ff3db4"; c.lineWidth = 1; c.setLineDash([4, 3]);
  for (const g of guides) {
    c.beginPath();
    if (g.x != null) { c.moveTo(g.x * s, 0); c.lineTo(g.x * s, doc.h * s); }
    else { c.moveTo(0, g.y * s); c.lineTo(doc.w * s, g.y * s); }
    c.stroke();
  }
  c.setLineDash([]);
  const el = sel();
  if (!el) return;
  const x = el.x * s, y = el.y * s, w = el.w * s, h = el.h * s;
  c.strokeStyle = el.locked ? "#999" : "#2f80ff"; c.lineWidth = 1.5;
  c.strokeRect(x, y, w, h);
  if (el.locked) return;
  for (const hd of handles(el)) {
    c.fillStyle = "#fff"; c.strokeStyle = "#2f80ff";
    c.beginPath(); c.arc(hd.x * s, hd.y * s, 5, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}

function handles(el) {
  const { x, y, w, h } = el;
  const all = [
    { k: "nw", x, y }, { k: "n", x: x + w / 2, y }, { k: "ne", x: x + w, y },
    { k: "e", x: x + w, y: y + h / 2 }, { k: "se", x: x + w, y: y + h },
    { k: "s", x: x + w / 2, y: y + h }, { k: "sw", x, y: y + h }, { k: "w", x, y: y + h / 2 },
  ];
  if (el.type === "line") return all.filter((a) => (el.rot % 180 ? "ns" : "ew").includes(a.k));
  return all;
}

// ============================================================ mouse interaction
let drag = null;
function mm(e) {
  const r = overlay.getBoundingClientRect(), s = screenScale();
  return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
}
function hit(p) {
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const el = doc.elements[i], pad = 0.6;
    if (p.x >= el.x - pad && p.x <= el.x + el.w + pad && p.y >= el.y - pad && p.y <= el.y + el.h + pad) return el;
  }
  return null;
}
function hitHandle(p) {
  const el = sel();
  if (!el || el.locked) return null;
  const r = 7 / screenScale();
  return handles(el).find((h) => Math.abs(h.x - p.x) < r && Math.abs(h.y - p.y) < r) || null;
}

overlay.addEventListener("pointerdown", (e) => {
  const p = mm(e);
  const hd = hitHandle(p);
  if (hd) { drag = { mode: "resize", k: hd.k, start: p, orig: deep(sel()) }; overlay.setPointerCapture(e.pointerId); return; }
  const el = hit(p);
  selId = el ? el.id : null;
  buildProps(); updateToolbar();
  if (el && !el.locked) { drag = { mode: "move", start: p, orig: deep(el) }; overlay.setPointerCapture(e.pointerId); }
  drawOverlay();
});

overlay.addEventListener("pointermove", (e) => {
  const p = mm(e);
  if (!drag) {
    const hd = hitHandle(p);
    const cursors = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };
    overlay.style.cursor = hd ? cursors[hd.k] : hit(p) ? "move" : "default";
    return;
  }
  const el = sel(), o = drag.orig, dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  guides = [];
  if (drag.mode === "move") {
    let nx = o.x + dx, ny = o.y + dy;
    // snapping: label center & edges
    const cxs = [[doc.w / 2, nx + o.w / 2], [0, nx], [doc.w, nx + o.w]];
    for (const [target, cur] of cxs) if (Math.abs(target - cur) < SNAP_MM) { nx += target - cur; guides.push({ x: target }); break; }
    const cys = [[doc.h / 2, ny + o.h / 2], [0, ny], [doc.h, ny + o.h]];
    for (const [target, cur] of cys) if (Math.abs(target - cur) < SNAP_MM) { ny += target - cur; guides.push({ y: target }); break; }
    el.x = round2(nx); el.y = round2(ny);
  } else {
    const k = drag.k, min = 1;
    let { x, y, w, h } = o;
    if (k.includes("e")) w = Math.max(min, o.w + dx);
    if (k.includes("s")) h = Math.max(min, o.h + dy);
    if (k.includes("w")) { w = Math.max(min, o.w - dx); x = o.x + o.w - w; }
    if (k.includes("n")) { h = Math.max(min, o.h - dy); y = o.y + o.h - h; }
    if ((el.type === "qr" || el.type === "icon") && k.length === 2) { const m = Math.max(w, h); if (k.includes("w")) x = o.x + o.w - m; if (k.includes("n")) y = o.y + o.h - m; w = h = m; }
    Object.assign(el, { x: round2(x), y: round2(y), w: round2(w), h: round2(h) });
  }
  render();
  refreshPropsGeometry();
});

overlay.addEventListener("pointerup", () => {
  if (drag) { drag = null; guides = []; commit(); render(); }
});

overlay.addEventListener("dblclick", (e) => {
  const el = hit(mm(e));
  if (!el) return;
  selId = el.id; buildProps();
  const f = document.querySelector("#props textarea, #props input[type=text]");
  if (f) { f.focus(); f.select(); }
});

const round2 = (v) => Math.round(v * 100) / 100;

// ============================================================ keyboard
document.addEventListener("keydown", (e) => {
  const tag = document.activeElement.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (e.ctrlKey && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); redo(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); saveTemplatePrompt(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === "p") { e.preventDefault(); openPrint(); return; }
  if (typing) return;
  const el = sel();
  if (!el) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del(); }
  else if (e.ctrlKey && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); }
  else if (e.ctrlKey && e.key.toLowerCase() === "c") { clipboard = deep(el); }
  else if (e.ctrlKey && e.key.toLowerCase() === "v" && clipboard) { const n = { ...deep(clipboard), id: uid(), x: clipboard.x + 1, y: clipboard.y + 1 }; doc.elements.push(n); selId = n.id; commit(); render(); buildProps(); }
  else if (e.key.startsWith("Arrow") && !el.locked) {
    e.preventDefault();
    const st = e.shiftKey ? 1 : 0.25;
    if (e.key === "ArrowLeft") el.x -= st; if (e.key === "ArrowRight") el.x += st;
    if (e.key === "ArrowUp") el.y -= st; if (e.key === "ArrowDown") el.y += st;
    el.x = round2(el.x); el.y = round2(el.y);
    render(); refreshPropsGeometry(); commit();
  } else if (e.key === "Escape") { selId = null; buildProps(); drawOverlay(); updateToolbar(); }
});

// ============================================================ element actions
function addElement(type) {
  const W = doc.w, H = doc.h, m = 1;
  const base = { id: uid(), rot: 0, locked: false };
  let el;
  switch (type) {
    case "text":
      el = { ...base, type, x: m, y: m, w: W - 2 * m, h: H - 2 * m, text: "نص جديد", font: "Arial", size: 3.5, bold: true, italic: false, underline: false, align: "center", fit: true, invert: false, spacing: 1.1 };
      break;
    case "date":
      el = { ...base, type: "text", x: m, y: m, w: W - 2 * m, h: H - 2 * m, text: "إنتاج: {date}\nانتهاء: {date+30}", font: "Arial", size: 2.5, bold: true, italic: false, underline: false, align: "center", fit: true, invert: false, spacing: 1.15 };
      break;
    case "serial":
      el = { ...base, type: "text", x: W - 12, y: m, w: 11, h: H - 2 * m, text: "#{n:3}", font: "Arial", size: 3, bold: true, italic: false, underline: false, align: "center", fit: true, invert: false, spacing: 1.1 };
      break;
    case "icon": {
      const s = Math.min(H - 2 * m, 8);
      el = { ...base, type, x: m, y: (H - s) / 2, w: s, h: s, char: "★" };
      break;
    }
    case "rect":
      el = { ...base, type, x: 0.5, y: 0.5, w: W - 1, h: H - 1, thick: 0.4, radius: 1.5, fill: false };
      break;
    case "line":
      el = { ...base, type, x: m, y: H / 2 - 0.5, w: W - 2 * m, h: 1, thick: 0.3, dash: false };
      break;
    case "table":
      el = { ...base, type, x: 0.5, y: 0.5, w: W - 1, h: H - 1, rows: 2, cols: 2, thick: 0.25, font: "Arial", bold: true, size: 2, rtl: true, cells: "الاسم|أحمد\nالسعر|25" };
      break;
    case "qr": {
      const s = H - 2 * m;
      el = { ...base, type, x: m, y: m, w: s, h: s, data: "https://example.com", ecc: "M" };
      break;
    }
    case "barcode":
      el = { ...base, type, x: m, y: m, w: W - 2 * m, h: H - 2 * m, data: "123456789", format: "CODE128", showText: true, textSize: 2 };
      break;
    case "excel":
      openBatch();
      return;
    case "image":
      $("fileImg").value = "";
      $("fileImg").click();
      return;
  }
  doc.elements.push(el);
  selId = el.id;
  commit(); render(); buildProps(); updateToolbar();
}

$("fileImg").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const im = new Image();
    im.onload = () => {
      // downscale big images to keep templates light
      const maxPx = 800, r = Math.min(1, maxPx / Math.max(im.width, im.height));
      const cv = document.createElement("canvas");
      cv.width = im.width * r; cv.height = im.height * r;
      const c = cv.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, cv.width, cv.height);
      c.drawImage(im, 0, 0, cv.width, cv.height);
      const src = cv.toDataURL("image/png");
      const H = doc.h - 1, W = Math.min(doc.w - 1, H * (im.width / im.height));
      const el = { id: uid(), type: "image", rot: 0, locked: false, x: (doc.w - W) / 2, y: 0.5, w: round2(W), h: H, src, threshold: 128, dither: true, invert: false };
      doc.elements.push(el); selId = el.id;
      commit(); render(); buildProps(); updateToolbar();
    };
    im.src = rd.result;
  };
  rd.readAsDataURL(f);
});

function del() {
  const el = sel(); if (!el) return;
  doc.elements = doc.elements.filter((e) => e.id !== el.id);
  selId = null; commit(); render(); buildProps(); updateToolbar();
}
function duplicate() {
  const el = sel(); if (!el) return;
  const n = { ...deep(el), id: uid(), x: el.x + 1, y: el.y + 1, locked: false };
  doc.elements.push(n); selId = n.id;
  commit(); render(); buildProps();
}
function rotate() {
  const el = sel(); if (!el || el.locked) return;
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  el.rot = ((el.rot || 0) + 90) % 360;
  [el.w, el.h] = [el.h, el.w];
  el.x = round2(cx - el.w / 2); el.y = round2(cy - el.h / 2);
  commit(); render(); buildProps();
}
function toggleLock() { const el = sel(); if (!el) return; el.locked = !el.locked; commit(); render(); updateToolbar(); }
function center(axis) {
  const el = sel(); if (!el || el.locked) return;
  if (axis === "h") el.x = round2((doc.w - el.w) / 2); else el.y = round2((doc.h - el.h) / 2);
  commit(); render(); refreshPropsGeometry();
}
function toFront() {
  const el = sel(); if (!el) return;
  doc.elements = doc.elements.filter((e) => e !== el);
  doc.elements.push(el); commit(); render();
}

// ============================================================ properties panel
const props = $("props");
const TYPE_NAMES = { text: "نص", icon: "أيقونة", rect: "إطار", line: "خط", table: "جدول", qr: "QR كود", barcode: "باركود", image: "صورة" };

function buildProps() {
  const el = sel();
  props.innerHTML = "";
  if (!el) {
    props.innerHTML = `<h3>الملصق</h3>
      <div class="row">
        <div class="field"><label>الطول (مم)</label><input type="number" id="docW" step="1" min="5" value="${doc.w}"></div>
        <div class="field"><label>العرض (مم)</label><input type="number" id="docH" step="0.5" min="5" value="${doc.h}"></div>
      </div>
      <div class="hint">أقصى عرض للطباعة في طابعتك: ${maxLabelH()} مم</div>
      <div class="empty-hint">اختار عنصر من الملصق لتعديله<br>أو أضف عنصر من الشريط تحت ⬇</div>
      <div class="hint" style="margin-top:20px; line-height:2">
        <b>اختصارات:</b><br>Del حذف · Ctrl+D تكرار<br>Ctrl+Z تراجع · Ctrl+Y إعادة<br>الأسهم للتحريك (Shift = أسرع)<br>Ctrl+S حفظ · Ctrl+P طباعة
      </div>`;
    const upd = () => { doc.w = clamp(+$("docW").value || 40, 5, 300); doc.h = clamp(+$("docH").value || 12, 5, 100); syncSize(); render(); commit(); };
    $("docW").onchange = upd; $("docH").onchange = upd;
    return;
  }
  const h = [];
  h.push(`<h3>${TYPE_NAMES[el.type] || ""}</h3>`);

  if (el.type === "text") {
    h.push(field("النص", `<textarea data-k="text" dir="auto">${esc(el.text)}</textarea>`));
    h.push(`<div class="hint" style="margin:-6px 0 12px">رموز: {date} تاريخ اليوم · {date+30} بعد 30 يوم · {time} الوقت · {n} رقم تسلسلي · {n:3} = 001</div>`);
    h.push(field("الخط", select("font", FONTS, el.font)));
    h.push(`<div class="row">${field("الحجم (مم)", `<input type="number" data-k="size" step="0.25" min="0.5" value="${round2(el.fit && el._px ? el._px : el.size)}" ${el.fit ? "disabled" : ""}>`)}${field("تباعد الأسطر", `<input type="number" data-k="spacing" step="0.05" min="0.7" max="3" value="${el.spacing}">`)}${field("تباعد الحروف", `<input type="number" data-k="letter" step="0.05" min="-0.5" max="3" value="${el.letter || 0}">`)}</div>`);
    if (!el.fit) h.push(`<input type="range" data-k="size" min="0.5" max="${Math.max(12, doc.h)}" step="0.25" value="${el.size}" style="width:100%;margin:-4px 0 10px">`);
    h.push(check("fit", "حجم تلقائي (ملء المربع)", el.fit));
    h.push(field("المحاذاة", seg("align", [["right", "يمين"], ["center", "وسط"], ["left", "يسار"]], el.align)));
    h.push(`<div class="row">${check("bold", "<b>عريض</b>", el.bold)}${check("italic", "<i>مائل</i>", el.italic)}${check("underline", "<u>تسطير</u>", el.underline)}${check("strike", "<s>شطب</s>", el.strike)}</div>`);
    h.push(check("invert", "أبيض على أسود", el.invert));
  }
  if (el.type === "icon") {
    h.push(`<div class="field"><label>اختر أيقونة</label><div class="icons-grid">${ICONS.map((c) => `<button data-icon="${c}">${c}</button>`).join("")}</div></div>`);
    h.push(field("أو اكتب رمز", `<input type="text" data-k="char" value="${esc(el.char)}" maxlength="4">`));
  }
  if (el.type === "rect") {
    h.push(`<div class="row">${field("السُمك (مم)", num("thick", el.thick, 0.1, 0.1))}${field("انحناء الزوايا", num("radius", el.radius, 0.5, 0))}</div>`);
    h.push(check("fill", "تعبئة كاملة", el.fill));
  }
  if (el.type === "line") {
    h.push(field("السُمك (مم)", num("thick", el.thick, 0.1, 0.1)));
    h.push(check("dash", "خط متقطع", el.dash));
  }
  if (el.type === "table") {
    h.push(`<div class="row">${field("الصفوف", num("rows", el.rows, 1, 1))}${field("الأعمدة", num("cols", el.cols, 1, 1))}</div>`);
    h.push(field("المحتوى (كل سطر صف، افصل الخانات بـ |)", `<textarea data-k="cells" dir="auto">${esc(el.cells)}</textarea>`));
    h.push(field("الخط", select("font", FONTS, el.font)));
    h.push(`<div class="row">${field("سُمك الخطوط", num("thick", el.thick, 0.05, 0.1))}</div>`);
    h.push(`<div class="row">${check("bold", "عريض", el.bold)}${check("rtl", "من اليمين لليسار", el.rtl)}</div>`);
  }
  if (el.type === "qr") {
    h.push(field("المحتوى (رابط أو نص)", `<textarea data-k="data" dir="auto">${esc(el.data)}</textarea>`));
    h.push(field("تصحيح الأخطاء", select("ecc", ["L", "M", "Q", "H"], el.ecc)));
  }
  if (el.type === "barcode") {
    h.push(field("الرقم", `<input type="text" data-k="data" value="${esc(el.data)}" dir="ltr">`));
    h.push(field("النوع", select("format", BARCODE_FORMATS, el.format)));
    h.push(`<div class="row">${check("showText", "إظهار الرقم", el.showText)}${field("حجم الرقم", num("textSize", el.textSize, 0.25, 1))}</div>`);
    h.push(`<div class="hint">EAN13: 12 أو 13 رقم · EAN8: 7 أو 8 أرقام · CODE128: أي نص إنجليزي</div>`);
  }
  if (el.type === "image") {
    h.push(field("درجة التحويل للأبيض والأسود", `<input type="range" data-k="threshold" min="20" max="235" value="${el.threshold}" style="width:100%">`));
    h.push(check("dither", "تدرج نقطي (للصور الفوتوغرافية)", el.dither));
    h.push(check("invert", "عكس الألوان", el.invert));
  }

  h.push(`<hr style="border:0;border-top:1px solid var(--line);margin:16px 0">`);
  h.push(`<div class="row">${field("X (مم)", num("x", el.x, 0.25))}${field("Y (مم)", num("y", el.y, 0.25))}</div>`);
  h.push(`<div class="row">${field("العرض", num("w", el.w, 0.25, 0.5))}${field("الارتفاع", num("h", el.h, 0.25, 0.5))}</div>`);
  props.innerHTML = h.join("");

  // bind inputs
  props.querySelectorAll("[data-k]").forEach((inp) => {
    const k = inp.dataset.k;
    const handler = () => {
      let v = inp.type === "checkbox" ? inp.checked : inp.type === "number" || inp.type === "range" ? parseFloat(inp.value) : inp.value;
      if (typeof v === "number" && isNaN(v)) return;
      if (k === "rows" || k === "cols") v = clamp(Math.round(v), 1, 12);
      el[k] = v;
      if (k === "fit") { if (!v && el._px) el.size = round2(el._px); buildProps(); }
      render();
    };
    inp.addEventListener("input", handler);
    inp.addEventListener("change", () => { handler(); commit(); });
  });
  props.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => {
    el[b.dataset.seg] = b.dataset.v; commit(); render(); buildProps();
  }));
  props.querySelectorAll("[data-icon]").forEach((b) => b.addEventListener("click", () => {
    el.char = b.dataset.icon; commit(); render(); buildProps();
  }));
}
function refreshPropsGeometry() {
  const el = sel(); if (!el) return;
  for (const k of ["x", "y", "w", "h"]) { const i = props.querySelector(`[data-k="${k}"]`); if (i && document.activeElement !== i) i.value = el[k]; }
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const field = (label, inner) => `<div class="field"><label>${label}</label>${inner}</div>`;
const num = (k, v, step = 1, min = "") => `<input type="number" data-k="${k}" step="${step}" ${min !== "" ? `min="${min}"` : ""} value="${v}">`;
const check = (k, label, v) => `<label class="check"><input type="checkbox" data-k="${k}" ${v ? "checked" : ""}> ${label}</label>`;
const select = (k, opts, v) => `<select data-k="${k}">${opts.map((o) => `<option ${o === v ? "selected" : ""} style="font-family:'${o}'">${o}</option>`).join("")}</select>`;
const seg = (k, opts, v) => `<div class="seg">${opts.map(([val, l]) => `<button data-seg="${k}" data-v="${val}" class="${val === v ? "on" : ""}">${l}</button>`).join("")}</div>`;

// ============================================================ toolbar
function updateToolbar() {
  const el = sel();
  for (const id of ["tbDelete", "tbRotate", "tbDup", "tbLock", "tbCenterH", "tbCenterV", "tbFront"]) $(id).disabled = !el;
  $("tbLock").classList.toggle("active", !!el?.locked);
  $("tbUndo").disabled = hIndex <= 0;
  $("tbRedo").disabled = hIndex >= history.length - 1;
  $("tbPreview").classList.toggle("active", printPreview);
  $("zoomLbl").textContent = Math.round(zoom * 100) + "%";
}
$("tbDelete").onclick = del;
$("tbRotate").onclick = rotate;
$("tbDup").onclick = duplicate;
$("tbLock").onclick = toggleLock;
$("tbUndo").onclick = undo;
$("tbRedo").onclick = redo;
$("tbCenterH").onclick = () => center("h");
$("tbCenterV").onclick = () => center("v");
$("tbFront").onclick = toFront;
$("tbZoomIn").onclick = () => { zoom = Math.min(4, zoom * 1.25); render(); updateToolbar(); };
$("tbZoomOut").onclick = () => { zoom = Math.max(0.3, zoom / 1.25); render(); updateToolbar(); };
$("tbPreview").onclick = () => { printPreview = !printPreview; render(); updateToolbar(); };
document.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => addElement(b.dataset.add)));
$("stage").addEventListener("pointerdown", (e) => { if (e.target === $("stage")) { selId = null; buildProps(); drawOverlay(); updateToolbar(); } });
$("stage").addEventListener("wheel", (e) => { if (e.ctrlKey) { e.preventDefault(); zoom = clamp(zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.3, 4); render(); updateToolbar(); } }, { passive: false });

function fitZoom() {
  const st = $("stage");
  zoom = clamp(Math.min((st.clientWidth - 100) / (doc.w * SCREEN_PX_PER_MM), (st.clientHeight - 100) / (doc.h * SCREEN_PX_PER_MM)), 0.3, 3);
}

// ============================================================ label size
const sizeSel = $("sizeSel");
function syncSize() {
  const opts = LABEL_SIZES.map(([w, h]) => `${w} × ${h}`);
  const cur = `${doc.w} × ${doc.h}`;
  if (!opts.includes(cur)) opts.push(cur);
  sizeSel.innerHTML = opts.map((o) => `<option ${o === cur ? "selected" : ""}>${o}</option>`).join("") + `<option value="custom">مقاس مخصص...</option>`;
}
sizeSel.onchange = () => {
  if (sizeSel.value === "custom") { selId = null; buildProps(); $("docW").focus(); syncSize(); return; }
  const [w, h] = sizeSel.value.split("×").map((x) => parseFloat(x));
  const sx = w / doc.w, sy = h / doc.h;
  for (const el of doc.elements) { el.x = round2(el.x * sx); el.w = round2(el.w * sx); el.y = round2(el.y * sy); el.h = round2(el.h * sy); }
  doc.w = w; doc.h = h;
  fitZoom(); commit(); render(); buildProps(); updateToolbar();
};

// ============================================================ printer connection
function log(msg) {
  const l = $("log");
  const t = new Date().toLocaleTimeString();
  l.textContent += `[${t}] ${msg}\n`;
  l.scrollTop = l.scrollHeight;
  console.log(msg);
  log._buf = (log._buf || "") + `[${t}] ${msg}\n`;
  clearTimeout(log._t);
  log._t = setTimeout(() => {
    const body = log._buf; log._buf = "";
    fetch("/log", { method: "POST", body }).catch(() => {});
  }, 300);
}
function toast(msg, ms = 2500) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}
function setConnected(name) {
  $("dot").classList.toggle("on", !!name);
  $("printerName").textContent = name || "اتصال بالطابعة";
  if (!name) $("battery").textContent = "";
}
printer.onDisconnect = () => { setConnected(null); log("انقطع الاتصال بالطابعة"); toast("انقطع الاتصال بالطابعة"); };

$("btnPrinter").onclick = async () => {
  if (printer.connected) {
    if (confirm("قطع الاتصال بالطابعة؟")) await printer.disconnect();
    return;
  }
  $("dlgConnect").showModal();
};
$("cUsb").onclick = () => { $("dlgConnect").close(); connectPrinter("usb"); };
$("cBle").onclick = () => { $("dlgConnect").close(); connectPrinter("ble"); };
$("cClose").onclick = () => $("dlgConnect").close();

async function connectPrinter(kind, port = null, silent = false) {
  if (connectPrinter.busy || printer.connected) return;
  connectPrinter.busy = true;
  if (!Niimbot.supported(kind)) {
    alert("المتصفح ده ما بيدعم الطريقة دي. افتح البرنامج في Microsoft Edge أو Google Chrome.");
    return;
  }
  try {
    $("printerName").textContent = "جاري الاتصال...";
    const name = await printer.connect(kind, port);
    const m = printer.info;
    if (settings.model !== name || settings.profileVer !== 7) {
      settings = { ...settings, dpi: m.dpi, head: m.head, densityMax: m.densityMax, density: m.density, model: name, flip: false, profileVer: 7 };
    } else {
      Object.assign(settings, { dpi: m.dpi, head: m.head, densityMax: m.densityMax });
    }
    saveJSON("ls.settings", settings);
    setConnected(name);
    toast("تم الاتصال بـ " + name);
    const bat = await printer.getBattery();
    if (bat != null) $("battery").textContent = `🔋 ${bat <= 4 ? ["", "25%", "50%", "75%", "100%"][bat] || bat : bat + "%"}`;
    render(); buildProps();
  } catch (e) {
    setConnected(null);
    if (e.name !== "NotFoundError") {
      log("خطأ في الاتصال: " + e.message);
      if (!silent) alert("تعذر الاتصال:\n" + e.message + "\n\nلو موقع niim.blue أو تطبيق تاني مفتوح، اقفله وجرّب تاني.");
    }
  } finally {
    connectPrinter.busy = false;
  }
}

// ============================================================ printing
function openPrint() {
  const d = $("pDensity");
  d.innerHTML = Array.from({ length: settings.densityMax }, (_, i) => `<option ${i + 1 === settings.density ? "selected" : ""}>${i + 1}</option>`).join("");
  $("serialField").style.display = JSON.stringify(project).includes("{n") ? "" : "none";
  $("pWhatField").style.display = project.pages.length > 1 ? "" : "none";
  $("pWhat").innerHTML = `<option value="cur">الصفحة الحالية فقط</option><option value="all">كل الصفحات (${project.pages.length})</option>`;
  const hasBatch = !!(batch && batch.rows.length);
  $("pBatchField").style.display = hasBatch ? "" : "none";
  if (hasBatch) {
    $("pBatchUse").checked = true;
    $("pFrom").value = 1; $("pFrom").max = batch.rows.length;
    $("pTo").value = batch.rows.length; $("pTo").max = batch.rows.length;
    $("pBatchInfo").textContent = `${batch.file} — ${batch.rows.length} صف`;
  }
  $("pBar").style.width = "0";
  $("pStatus").textContent = printer.connected ? "جاهز" : "⚠ الطابعة غير متصلة";
  $("pGo").disabled = false;
  $("dlgPrint").showModal();
}
$("btnPrint").onclick = openPrint;
$("pClose").onclick = () => $("dlgPrint").close();
$("pGo").onclick = async () => {
  if (!printer.connected) { $("btnPrinter").click(); return; }
  const copies = clamp(+$("pCopies").value || 1, 1, 999);
  const density = +$("pDensity").value;
  const serial0 = +$("pSerial").value || 1;
  settings.density = density; saveJSON("ls.settings", settings);
  const pagesSel = $("pWhat").value === "all" && project.pages.length > 1 ? project.pages : [doc];
  const useBatch = !!(batch && batch.rows.length && $("pBatchUse").checked);
  const from = clamp(+$("pFrom").value || 1, 1, batch?.rows.length || 1);
  const to = clamp(+$("pTo").value || from, from, batch?.rows.length || 1);
  const rows = useBatch ? batch.rows.slice(from - 1, to) : [batchRow()];
  if (pagesSel.some((p) => p.h > maxLabelH() + 0.01)) toast(`تنبيه: عرض الملصق أكبر من رأس الطباعة (${maxLabelH()} مم) وسيتم قص الأطراف`, 4000);

  $("pGo").disabled = true;
  $("pStatus").textContent = "جاري التجهيز...";
  try {
    const s = dpm();
    const pages = [];
    const hasSerial = JSON.stringify(pagesSel).includes("{n");
    let serial = serial0;
    for (const row of rows) for (const pg of pagesSel) {
      let first = null;
      for (let i = 0; i < copies; i++) {
        if (first && !hasSerial) { pages.push(first); continue; }
        const cv = renderTo(document.createElement("canvas"), s, { serial: serial++, printScale: s, row }, pg);
        threshold(cv);
        first = cropToHead(cv, settings.head);
        pages.push(first);
      }
    }
    if (pages.length > 300 && !confirm(`حيتم طباعة ${pages.length} ملصق. متأكد؟`)) throw new Error("تم الإلغاء");
    await printer.printCanvases(pages, { density, flip: settings.flip }, (f, p, t) => {
      $("pBar").style.width = (f * 100).toFixed(1) + "%";
      $("pStatus").textContent = `جاري الطباعة... ${p} / ${t}`;
    });
    $("pBar").style.width = "100%";
    $("pStatus").textContent = "✔ تمت الطباعة";
    log("تمت الطباعة");
    addHistory(pagesSel, pages[0], pages.length);
    if (hasSerial) $("pSerial").value = serial;
  } catch (e) {
    $("pStatus").textContent = "✖ خطأ: " + e.message;
    log("خطأ في الطباعة: " + e.message);
  }
  $("pGo").disabled = false;
};

// keep only the rows the printhead can print (centered)
function cropToHead(cv, head) {
  if (cv.height <= head) return cv;
  const out = document.createElement("canvas");
  out.width = cv.width; out.height = head;
  out.getContext("2d").drawImage(cv, 0, -Math.floor((cv.height - head) / 2));
  return out;
}

// ============================================================ settings dialog
$("btnSettings").onclick = () => {
  const i = printer.connected ? printer.info : null;
  $("sInfo").innerHTML = i
    ? `الطابعة: <b>${esc(printer.deviceName)}</b><br>الموديل: ${i.model} · الدقة: ${i.dpi} DPI · رأس الطباعة: ${i.head} نقطة<br>طريقة الطباعة: ${i.task} · البروتوكول: ${i.protocol ?? "-"}`
    : "الطابعة غير متصلة";
  $("sFlip").checked = settings.flip;
  $("dlgSettings").showModal();
};
$("sClose").onclick = () => $("dlgSettings").close();
$("sCopyLog").onclick = async () => {
  try { await navigator.clipboard.writeText($("log").textContent); toast("تم نسخ السجل"); } catch { toast("تعذر النسخ"); }
};
$("sSave").onclick = () => {
  settings.flip = $("sFlip").checked;
  saveJSON("ls.settings", settings);
  $("dlgSettings").close(); render(); buildProps(); toast("تم حفظ الإعدادات");
};

// ============================================================ templates
const getTemplates = () => { try { return JSON.parse(localStorage.getItem("ls.templates") || "[]"); } catch { return []; } };
const setTemplates = (t) => { try { localStorage.setItem("ls.templates", JSON.stringify(t)); return true; } catch { alert("المساحة ممتلئة. احذف بعض القوالب أو صدّرها كملفات."); return false; } };

function saveTemplatePrompt() {
  const name = prompt("اسم القالب:", project.name || "ملصق " + new Date().toLocaleDateString("ar"));
  if (!name) return;
  project.name = name;
  const list = getTemplates().filter((t) => t.name !== name);
  list.unshift({ name, project: { pages: deep(project.pages), name }, date: Date.now() });
  if (setTemplates(list)) toast("تم حفظ القالب: " + name);
  commit();
}
$("btnSave").onclick = saveTemplatePrompt;

function renderTplList() {
  const list = getTemplates();
  $("tplList").innerHTML = list.length ? list.map((t, i) => `
    <div class="tpl"><span data-open="${i}">📄 ${esc(t.name)} <small class="hint">${tplInfo(t)}</small></span>
    <button class="btn" data-delt="${i}">🗑</button></div>`).join("") : `<div class="empty-hint" style="margin:10px">لا توجد قوالب محفوظة بعد</div>`;
  $("tplList").querySelectorAll("[data-open]").forEach((s) => (s.onclick = () => { const t = list[+s.dataset.open]; loadDoc(t.project || t.doc); $("dlgTpl").close(); }));
  $("tplList").querySelectorAll("[data-delt]").forEach((b) => (b.onclick = () => { if (confirm("حذف القالب؟")) { list.splice(+b.dataset.delt, 1); setTemplates(list); renderTplList(); } }));
}
function tplInfo(t) {
  const pages = t.project ? t.project.pages : [t.doc];
  return pages.length > 1 ? `${pages.length} صفحات` : `${pages[0].w}×${pages[0].h}`;
}
function loadDoc(d) {
  project = toProject(d); doc = project.pages[0];
  selId = null; syncSize(); fitZoom(); commit(); render(); buildProps(); updateToolbar(); renderPagesBar();
}
$("btnTemplates").onclick = () => { renderPresets(); renderTplList(); $("dlgTpl").showModal(); };
$("tClose").onclick = () => $("dlgTpl").close();
$("tNew").onclick = () => { if (confirm("بدء ملصق جديد؟ (التغييرات غير المحفوظة ستضيع)")) { loadDoc(newDoc(doc.w, doc.h)); $("dlgTpl").close(); } };
$("tExport").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ name: project.name, pages: project.pages }, null, 1)], { type: "application/json" }));
  a.download = (project.name || "label") + ".json"; a.click();
};
$("tImport").onclick = () => { $("fileTpl").value = ""; $("fileTpl").click(); };
$("fileTpl").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d.elements && !d.pages) throw 0; loadDoc(d); $("dlgTpl").close(); toast("تم فتح الملف"); }
  catch { alert("الملف غير صالح"); }
};

// ============================================================ pages (artboards)
function renderPagesBar() {
  const bar = $("pagesBar");
  bar.innerHTML = project.pages.map((p, i) => {
    const on = i === project.cur;
    return `<div class="ptab ${on ? "on" : ""}" data-p="${i}" title="اضغط مرتين لتغيير الاسم">
      <span class="pname">${esc(p.title || "صفحة " + (i + 1))}</span><small>${p.w}×${p.h}</small>
      ${on ? `<button class="pact" data-act="dup" title="تكرار الصفحة">⧉</button>${project.pages.length > 1 ? `<button class="pact" data-act="del" title="حذف الصفحة">✕</button>` : ""}` : ""}
    </div>`;
  }).join("") + `<button class="ptab padd" id="pageAdd" title="صفحة جديدة">＋ صفحة</button>`;
  bar.querySelectorAll(".ptab[data-p]").forEach((t) => {
    t.onclick = (e) => {
      const act = e.target.dataset.act;
      if (act === "dup") return duplicatePage();
      if (act === "del") return deletePage();
      switchPage(+t.dataset.p);
    };
    t.ondblclick = (e) => {
      if (e.target.dataset.act) return;
      const p = project.pages[+t.dataset.p];
      const n = prompt("اسم الصفحة:", p.title || "صفحة " + (+t.dataset.p + 1));
      if (n !== null) { p.title = n.trim() || undefined; commit(); renderPagesBar(); }
    };
  });
  $("pageAdd").onclick = addPage;
}
function switchPage(i) {
  if (i === project.cur) return;
  project.cur = i; doc = project.pages[i]; selId = null;
  syncSize(); fitZoom(); render(); buildProps(); updateToolbar(); renderPagesBar(); commit();
}
function addPage() {
  project.pages.push(newDoc(doc.w, doc.h));
  project.cur = project.pages.length - 1; doc = project.pages[project.cur]; selId = null;
  syncSize(); fitZoom(); render(); buildProps(); updateToolbar(); renderPagesBar(); commit();
  toast("تمت إضافة صفحة جديدة");
}
function duplicatePage() {
  const copy = deep(doc);
  copy.elements.forEach((e) => (e.id = uid()));
  if (copy.title) copy.title += " (نسخة)";
  project.pages.splice(project.cur + 1, 0, copy);
  project.cur++; doc = project.pages[project.cur]; selId = null;
  render(); buildProps(); updateToolbar(); renderPagesBar(); commit();
}
function deletePage() {
  if (project.pages.length < 2 || !confirm("حذف الصفحة دي؟")) return;
  project.pages.splice(project.cur, 1);
  project.cur = Math.min(project.cur, project.pages.length - 1); doc = project.pages[project.cur]; selId = null;
  syncSize(); fitZoom(); render(); buildProps(); updateToolbar(); renderPagesBar(); commit();
}

// ============================================================ Excel / batch printing
function batchRow() {
  return batch && batch.rows.length ? batch.rows[clamp(batch.cur || 0, 0, batch.rows.length - 1)] : null;
}
function saveBatch() {
  try { batch ? localStorage.setItem("ls.batch", JSON.stringify(batch)) : localStorage.removeItem("ls.batch"); }
  catch { toast("الملف كبير، ما اتحفظ للمرة الجاية لكنه شغال هسي"); }
}
function renderBatchBar() {
  const bar = $("batchBar");
  if (!batch || !batch.rows.length) { bar.style.display = "none"; return; }
  bar.style.display = "";
  $("bPos").textContent = `صف ${batch.cur + 1} من ${batch.rows.length}`;
  $("bFile").textContent = "📊 " + batch.file;
}
$("bPrev").onclick = () => { if (batch.cur > 0) { batch.cur--; saveBatch(); render(); } };
$("bNext").onclick = () => { if (batch.cur < batch.rows.length - 1) { batch.cur++; saveBatch(); render(); } };
$("bEdit").onclick = () => openBatch();

function openBatch() {
  renderBatchDlg();
  $("dlgBatch").showModal();
}
function renderBatchDlg() {
  const has = !!(batch && batch.rows.length);
  $("xInfo").innerHTML = has
    ? `الملف: <b>${esc(batch.file)}</b> — ${batch.rows.length} صف، ${batch.cols.length} عمود`
    : "اختار ملف Excel أو CSV. أول صف في الملف لازم يكون أسماء الأعمدة (مثلاً: الاسم، السعر، الكود).";
  $("xCols").innerHTML = has ? batch.cols.map((c) => `<button class="chip" data-col="${esc(c)}">{${esc(c)}}</button>`).join("") : "";
  $("xColsWrap").style.display = has ? "" : "none";
  $("xClear").style.display = has ? "" : "none";
  $("xCols").querySelectorAll("[data-col]").forEach((b) => (b.onclick = () => insertColumn(b.dataset.col)));
  if (has) {
    const head = batch.cols.slice(0, 6);
    $("xPreview").innerHTML = `<table><tr>${head.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>` +
      batch.rows.slice(0, 5).map((r) => `<tr>${head.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("") +
      `</table>${batch.rows.length > 5 ? `<div class="hint">... و ${batch.rows.length - 5} صف كمان</div>` : ""}`;
  } else $("xPreview").innerHTML = "";
}
function insertColumn(col) {
  const tag = `{${col}}`;
  const el = sel();
  if (el && el.type === "text") el.text = el.text && el.text !== "نص جديد" ? el.text + " " + tag : tag;
  else if (el && (el.type === "qr" || el.type === "barcode")) el.data = tag;
  else if (el && el.type === "table") el.cells = (el.cells ? el.cells + "\n" : "") + col + "|" + tag;
  else {
    addElement("text");
    sel().text = tag;
  }
  commit(); render(); buildProps();
  toast(`تمت إضافة ${tag}`);
}
$("xPick").onclick = () => { $("fileXls").value = ""; $("fileXls").click(); };
$("fileXls").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    let wb;
    if (/\.csv$/i.test(f.name)) wb = XLSX.read(await f.text(), { type: "string" });
    else wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
    const cols = (grid[0] || []).map((c, i) => String(c).trim() || `عمود${i + 1}`);
    const rows = grid.slice(1)
      .filter((r) => r.some((v) => String(v).trim() !== ""))
      .map((r) => Object.fromEntries(cols.map((c, i) => [c, String(r[i] ?? "").trim()])));
    if (!cols.length || !rows.length) throw new Error("الملف فاضي");
    batch = { file: f.name, cols, rows, cur: 0 };
    saveBatch(); renderBatchDlg(); render();
    log(`Excel: ${f.name} — ${rows.length} صف، أعمدة: ${cols.join("، ")}`);
  } catch (err) {
    alert("تعذر قراءة الملف: " + err.message);
  }
};
$("xClear").onclick = () => { if (confirm("إلغاء ربط ملف Excel؟")) { batch = null; saveBatch(); renderBatchDlg(); render(); } };
$("xClose").onclick = () => $("dlgBatch").close();

// ============================================================ USB auto-connect
async function autoConnect() {
  if (!navigator.serial || printer.connected) return;
  try {
    const ports = await navigator.serial.getPorts();
    if (ports.length) connectPrinter("usb", ports[0], true);
  } catch {}
}
if (navigator.serial) {
  navigator.serial.addEventListener("connect", (e) => {
    if (!printer.connected) setTimeout(() => connectPrinter("usb", e.target, true), 800);
  });
}

// keep the local server alive while the app is open (it exits when the window closes)
setInterval(() => fetch("/ping", { method: "POST" }).catch(() => {}), 15000);
fetch("/ping", { method: "POST" }).catch(() => {});

// ============================================================ ready-made templates
const T = (x, y, w, h, text, o = {}) => ({
  id: uid(), type: "text", x, y, w, h, rot: 0, locked: false, text, font: "Arial", size: 3, bold: true, italic: false,
  underline: false, strike: false, align: "center", fit: true, invert: false, spacing: 1.1, ...o,
});
const R = (x, y, w, h, o = {}) => ({ id: uid(), type: "rect", x, y, w, h, rot: 0, locked: false, thick: 0.35, radius: 1.2, fill: false, ...o });
const I = (x, y, s, char) => ({ id: uid(), type: "icon", x, y, w: s, h: s, rot: 0, locked: false, char });

const PRESETS = [
  { name: "ملصق سعر", make: (W, H) => [
    T(W * 0.42, 0.6, W * 0.58 - 1, H - 1.2, "اسم المنتج"),
    T(0.6, 0.6, W * 0.4 - 0.6, H * 0.62, "250", { invert: true }),
    T(0.6, 0.5 + H * 0.62, W * 0.4 - 0.6, H * 0.38 - 1.1, "جنيه", { invert: true, bold: false }),
  ] },
  { name: "عرض خاص (سعر مشطوب)", make: (W, H) => [
    T(0.6, 0.6, W * 0.2, H - 1.2, "عرض", { invert: true }),
    T(W * 0.23, 0.6, W * 0.32, H * 0.45, "اسم المنتج"),
    T(W * 0.23, H * 0.5, W * 0.32, H * 0.42, "300 جنيه", { strike: true, bold: false }),
    T(W * 0.57, 0.6, W * 0.43 - 0.8, H - 1.2, "250"),
  ] },
  { name: "صلاحية (إنتاج وانتهاء)", make: (W, H) => [
    T(0.6, 0.6, W - 1.2, H * 0.4, "اسم الصنف", { invert: true }),
    T(0.6, H * 0.46, W - 1.2, H * 0.5, "إنتاج: {date}\nانتهاء: {date+7}", { spacing: 1.15 }),
  ] },
  { name: "اسم", make: (W, H) => [
    R(0.5, 0.5, W - 1, H - 1, { thick: 0.4, radius: 2 }),
    T(2, 1.5, W - 4, H - 3, "محمد أحمد"),
  ] },
  { name: "ملف / مجلد", make: (W, H) => [
    T(W * 0.72, 0.6, W * 0.28 - 0.6, H - 1.2, "2026", { invert: true }),
    T(0.8, 0.6, W * 0.7 - 1.2, H * 0.55, "عقود الموردين"),
    T(0.8, H * 0.58, W * 0.7 - 1.2, H * 0.36, "قسم المشتريات", { bold: false }),
  ] },
  { name: "كابل", make: (W, H) => [
    I(W - H * 0.7 - 0.8, H * 0.15, H * 0.7, "⚡"),
    T(0.8, 0.8, W - H * 0.7 - 2.2, H - 1.6, "راوتر ← تلفزيون"),
  ] },
  { name: "منتج بباركود", make: (W, H) => [
    T(0.8, 0.4, W - 1.6, H * 0.32, "اسم المنتج — 250 جنيه"),
    { id: uid(), type: "barcode", x: W * 0.12, y: H * 0.36, w: W * 0.76, h: H * 0.6, rot: 0, locked: false, data: "6221234567890", format: "CODE128", showText: true, textSize: 1.6 },
  ] },
  { name: "رابط QR", make: (W, H) => [
    { id: uid(), type: "qr", x: 0.8, y: 0.8, w: H - 1.6, h: H - 1.6, rot: 0, locked: false, data: "https://example.com", ecc: "M" },
    T(H, 0.8, W - H - 0.8, H - 1.6, "امسح الكود\nلزيارة موقعنا", { spacing: 1.15 }),
  ] },
  { name: "رقم تلفون", make: (W, H) => [
    I(W - H * 0.75 - 0.8, H * 0.125, H * 0.75, "☎"),
    T(0.8, 0.8, W - H * 0.75 - 2.2, H - 1.6, "0912345678"),
  ] },
  { name: "تحذير", make: (W, H) => [
    I(W - H * 0.8 - 0.6, H * 0.1, H * 0.8, "⚠"),
    T(0.6, 0.8, W - H * 0.8 - 1.8, H - 1.6, "قابل للكسر", { invert: true }),
  ] },
  { name: "ترقيم تسلسلي", make: (W, H) => [
    R(0.5, 0.5, W - 1, H - 1),
    T(W * 0.5, 1.2, W * 0.5 - 1.8, H - 2.4, "أصل رقم", { bold: false }),
    T(1.8, 1.2, W * 0.5 - 2.6, H - 2.4, "{n:4}"),
  ] },
  { name: "فاضي", make: () => [] },
];

function presetPage(p) {
  const els = p.make(doc.w, doc.h);
  return { w: doc.w, h: doc.h, title: p.name, elements: els.map((e) => ({ ...e, x: round2(e.x), y: round2(e.y), w: round2(e.w), h: round2(e.h) })) };
}
function renderPresets() {
  const g = $("presetGrid");
  g.innerHTML = "";
  PRESETS.forEach((p) => {
    const b = document.createElement("button");
    b.className = "preset";
    const cv = renderTo(document.createElement("canvas"), 6, {}, presetPage(p));
    b.appendChild(cv);
    const n = document.createElement("span"); n.textContent = p.name; b.appendChild(n);
    b.onclick = () => {
      const page = presetPage(p);
      const emptyCur = doc.elements.length === 0;
      if (emptyCur) { project.pages[project.cur] = page; }
      else { project.pages.push(page); project.cur = project.pages.length - 1; }
      doc = project.pages[project.cur]; selId = null;
      syncSize(); fitZoom(); render(); buildProps(); updateToolbar(); renderPagesBar(); commit();
      $("dlgTpl").close();
      toast(emptyCur ? "تم تطبيق القالب" : "تمت إضافة القالب في صفحة جديدة");
    };
    g.appendChild(b);
  });
}

// ============================================================ print history
const getHistory = () => { try { return JSON.parse(localStorage.getItem("ls.history") || "[]"); } catch { return []; } };
function setHistory(list) {
  while (list.length) {
    try { localStorage.setItem("ls.history", JSON.stringify(list)); return; }
    catch { list.pop(); } // storage full: drop the oldest
  }
  try { localStorage.removeItem("ls.history"); } catch {}
}
function addHistory(pagesPrinted, firstCanvas, count) {
  try {
    const pages = deep(pagesPrinted);
    const key = JSON.stringify(pages);
    let list = getHistory();
    const old = list.find((h) => JSON.stringify(h.pages) === key);
    list = list.filter((h) => h !== old);
    list.unshift({
      date: Date.now(), name: project.name || pages[0].title || "",
      count: (old ? old.count : 0) + count, last: count,
      thumb: firstCanvas.toDataURL("image/png"), pages,
    });
    setHistory(list.slice(0, 30));
  } catch (e) { console.warn(e); }
}
function renderHistory() {
  const list = getHistory();
  $("histList").innerHTML = list.length ? list.map((h, i) => `
    <div class="hist">
      <img src="${h.thumb}" alt="">
      <div class="hmeta"><b>${esc(h.name || "ملصق")}</b>
        <small class="hint">${new Date(h.date).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })} · اتطبع ${h.count} مرة${h.pages.length > 1 ? ` · ${h.pages.length} صفحات` : ""}</small></div>
      <button class="btn" data-hprint="${i}">🖨 طباعة</button>
      <button class="btn" data-hopen="${i}">فتح</button>
      <button class="btn" data-hdel="${i}">🗑</button>
    </div>`).join("") : `<div class="empty-hint" style="margin:10px">لسه ما طبعت أي ملصق</div>`;
  const open = (i) => { loadDoc({ pages: list[i].pages, name: list[i].name || undefined }); $("dlgHistory").close(); };
  $("histList").querySelectorAll("[data-hopen]").forEach((b) => (b.onclick = () => { open(+b.dataset.hopen); toast("تم فتح الملصق (Ctrl+Z للرجوع للشغل السابق)"); }));
  $("histList").querySelectorAll("[data-hprint]").forEach((b) => (b.onclick = () => { open(+b.dataset.hprint); openPrint(); if (project.pages.length > 1) $("pWhat").value = "all"; }));
  $("histList").querySelectorAll("[data-hdel]").forEach((b) => (b.onclick = () => { list.splice(+b.dataset.hdel, 1); setHistory(list); renderHistory(); }));
}
$("btnHistory").onclick = () => { renderHistory(); $("dlgHistory").showModal(); };
$("hClose").onclick = () => $("dlgHistory").close();
$("hClear").onclick = () => { if (confirm("مسح كل سجل الطباعة؟")) { setHistory([]); renderHistory(); } };

// ============================================================ backup / restore
const BACKUP_KEYS = ["ls.project", "ls.templates", "ls.history", "ls.settings", "ls.batch"];
$("tBackup").onclick = () => {
  const data = { app: "niimdesk", version: 1, date: new Date().toISOString(), store: {} };
  for (const k of BACKUP_KEYS) { const v = localStorage.getItem(k); if (v != null) data.store[k] = v; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = `niimdesk-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  toast("تم حفظ النسخة الاحتياطية في مجلد التنزيلات");
};
$("tRestore").onclick = () => { $("fileBackup").value = ""; $("fileBackup").click(); };
$("fileBackup").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!["niimdesk", "label-studio"].includes(data.app) || !data.store) throw new Error("ده ما ملف نسخة احتياطية");
    if (!confirm("استرجاع النسخة الاحتياطية حيبدّل الشغل الحالي والقوالب والسجل. متأكد؟")) return;
    for (const k of BACKUP_KEYS) {
      if (typeof data.store[k] === "string") { JSON.parse(data.store[k]); localStorage.setItem(k, data.store[k]); }
    }
    location.reload();
  } catch (err) { alert("تعذر الاسترجاع: " + err.message); }
};

// ============================================================ init
window.addEventListener("resize", () => render());
syncSize();
fitZoom();
render();
buildProps();
updateToolbar();
renderPagesBar();
if (!Niimbot.supported("usb") && !Niimbot.supported("ble")) toast("⚠ افتح البرنامج في Edge أو Chrome عشان الطابعة تشتغل", 6000);
autoConnect();
