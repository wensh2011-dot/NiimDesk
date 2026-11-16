// NiimDesk launcher (single-file EXE).
// A tiny local web server that serves the app files embedded in this EXE on http://localhost:<port>/
// and opens them in an Edge/Chrome app window. It listens on localhost only, needs no admin rights,
// installs nothing, and exits by itself about a minute after the app window is closed.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("NiimDesk")]
[assembly: AssemblyDescription("NiimDesk - free label designer for NIIMBOT label printers (unofficial, not affiliated with NIIMBOT)")]
[assembly: AssemblyProduct("NiimDesk")]
[assembly: AssemblyCompany("NiimDesk open-source project")]
[assembly: AssemblyCopyright("Open-source components: niimbluelib (MIT), JsBarcode (MIT), qrcode-generator (MIT), SheetJS (Apache-2.0)")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Program
{
    static readonly int[] Ports = { 8765, 8766, 8767, 8768 };
    const int IdleExitSeconds = 60;
    const int MaxLogBytes = 1024 * 1024;

    static DateTime lastPing;
    static string dataDir;
    static int port;

    [STAThread]
    static void Main()
    {
        dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NiimDesk");
        Directory.CreateDirectory(dataDir);
        string portFile = Path.Combine(dataDir, "port.txt");

        bool first;
        using (Mutex mutex = new Mutex(true, "NiimDesk_Launcher", out first))
        {
            if (!first)
            {
                // already running: just open another window
                int p = Ports[0];
                try { p = int.Parse(File.ReadAllText(portFile).Trim()); } catch { }
                OpenWindow(p);
                return;
            }

            HttpListener listener = null;
            foreach (int p in Ports)
            {
                try
                {
                    HttpListener l = new HttpListener();
                    l.Prefixes.Add("http://localhost:" + p + "/");
                    l.Start();
                    listener = l;
                    port = p;
                    break;
                }
                catch { }
            }
            if (listener == null)
            {
                MessageBox.Show("Could not start NiimDesk: local ports 8765-8768 are in use.",
                    "NiimDesk", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            try { File.WriteAllText(portFile, port.ToString()); } catch { }

            lastPing = DateTime.UtcNow.AddSeconds(60); // startup grace
            Thread server = new Thread(delegate() { Serve(listener); });
            server.IsBackground = true;
            server.Start();

            // NIIMDESK_NO_WINDOW=1 is for automated tests only
            if (Environment.GetEnvironmentVariable("NIIMDESK_NO_WINDOW") != "1") OpenWindow(port);

            while ((DateTime.UtcNow - lastPing).TotalSeconds < IdleExitSeconds) Thread.Sleep(3000);
            try { listener.Stop(); } catch { }
        }
    }

    static void OpenWindow(int p)
    {
        string url = "http://localhost:" + p + "/";
        string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "";
        string pf = Environment.GetEnvironmentVariable("ProgramFiles") ?? "";
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] browsers = {
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
        };
        foreach (string exe in browsers)
        {
            if (!File.Exists(exe)) continue;
            try { Process.Start(exe, "--app=" + url + " --window-size=1400,900"); return; } catch { }
        }
        try { Process.Start(url); }
        catch
        {
            MessageBox.Show("Open this address in Microsoft Edge or Google Chrome:\n" + url, "NiimDesk");
        }
    }

    static void Serve(HttpListener listener)
    {
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); } catch { return; }
            ThreadPool.QueueUserWorkItem(delegate(object o)
            {
                try { Handle((HttpListenerContext)o); } catch { }
                try { ((HttpListenerContext)o).Response.Close(); } catch { }
            }, ctx);
        }
    }

    static void Handle(HttpListenerContext ctx)
    {
        HttpListenerRequest req = ctx.Request;
        HttpListenerResponse res = ctx.Response;
        res.Headers["Cache-Control"] = "no-store";
        res.Headers["X-Content-Type-Options"] = "nosniff";
        string path = req.Url.AbsolutePath;

        if (req.HttpMethod == "POST")
        {
            // only the app itself (same origin) may post
            string origin = req.Headers["Origin"];
            if (!string.IsNullOrEmpty(origin) && origin != "http://localhost:" + port)
            {
                res.StatusCode = 403;
                return;
            }
            if (path == "/ping")
            {
                lastPing = DateTime.UtcNow;
                res.StatusCode = 204;
            }
            else if (path == "/log")
            {
                byte[] buf = new byte[64 * 1024];
                int n = 0, r;
                while (n < buf.Length && (r = req.InputStream.Read(buf, n, buf.Length - n)) > 0) n += r;
                AppendLog(buf, n);
                res.StatusCode = 204;
            }
            else res.StatusCode = 404;
            return;
        }

        if (req.HttpMethod != "GET") { res.StatusCode = 405; return; }
        if (path == "/") path = "/index.html";
        Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("www" + path);
        if (s == null) { res.StatusCode = 404; return; }
        using (s)
        {
            res.ContentType = Mime(path);
            res.ContentLength64 = s.Length;
            s.CopyTo(res.OutputStream);
        }
    }

    static readonly object logLock = new object();
    static void AppendLog(byte[] buf, int n)
    {
        lock (logLock)
        {
            try
            {
                string file = Path.Combine(dataDir, "log.txt");
                FileInfo fi = new FileInfo(file);
                if (fi.Exists && fi.Length > MaxLogBytes) File.Delete(file);
                using (FileStream f = new FileStream(file, FileMode.Append, FileAccess.Write)) f.Write(buf, 0, n);
            }
            catch { }
        }
    }

    static string Mime(string path)
    {
        string ext = Path.GetExtension(path).ToLowerInvariant();
        switch (ext)
        {
            case ".html": return "text/html; charset=utf-8";
            case ".js": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".txt": return "text/plain; charset=utf-8";
            case ".png": return "image/png";
            case ".ico": return "image/x-icon";
            case ".svg": return "image/svg+xml";
            default: return "application/octet-stream";
        }
    }
}
