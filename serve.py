"""
NiimDesk launcher (development: runs the app from source files).
- Serves the app on http://localhost:8765 and saves the printer log to log.txt
- Opens the app in its own window (Edge/Chrome app mode)
- Exits by itself a little after the app window is closed (the page pings /ping)
"""
import http.server
import os
import shutil
import socket
import subprocess
import threading
import time
import webbrowser

PORT = 8765
URL = f"http://localhost:{PORT}/"
ROOT = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(ROOT, "log.txt")
IDLE_EXIT_SECONDS = 60

last_ping = time.time()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_POST(self):
        global last_ping
        n = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(n) if n else b""
        if self.path == "/log":
            with open(LOG, "a", encoding="utf-8") as f:
                f.write(body.decode("utf-8", "replace"))
        elif self.path == "/ping":
            last_ping = time.time()
        else:
            self.send_error(404)
            return
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def find_browser():
    candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome")


def open_window():
    exe = find_browser()
    if exe:
        subprocess.Popen([exe, f"--app={URL}", "--window-size=1400,900"])
    else:
        webbrowser.open(URL)


def port_in_use():
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def idle_watchdog(srv):
    while True:
        time.sleep(10)
        if time.time() - last_ping > IDLE_EXIT_SECONDS:
            srv.shutdown()
            return


if __name__ == "__main__":
    if port_in_use():  # already running: just open another window
        open_window()
    else:
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
        threading.Thread(target=idle_watchdog, args=(srv,), daemon=True).start()
        open_window()
        srv.serve_forever()
