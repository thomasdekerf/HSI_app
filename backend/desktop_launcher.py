"""Windows GUI entry point. --smoke-test also exercises the frozen application."""
import argparse
import json
import logging
from logging.handlers import RotatingFileHandler
import multiprocessing
import os
from pathlib import Path
import sys
import tempfile
import traceback
import webbrowser


def configure_logging():
    base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share")))
    log_dir = base / "HSI-App" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[RotatingFileHandler(log_dir / "app.log", maxBytes=2_000_000, backupCount=2, encoding="utf-8")],
        force=True,
    )
    # Windowed PyInstaller executables have no stdout/stderr. Some scientific
    # libraries still write diagnostics there.
    if sys.stdout is None:
        sys.stdout = open(log_dir / "console.log", "a", encoding="utf-8", buffering=1)
    if sys.stderr is None:
        sys.stderr = sys.stdout
    return log_dir


def smoke_test(server):
    """Exercise actual HTTP requests and native dependencies inside the bundle."""
    import httpx
    import numpy as np
    import spectral.io.envi as envi

    # Confirm Tcl/Tk was bundled as well, without leaving a launcher open.
    if sys.platform == "win32":
        import tkinter as tk
        window = tk.Tk()
        window.withdraw()
        window.update()
        window.destroy()

    with tempfile.TemporaryDirectory(prefix="hsi-smoke-") as folder:
        # Spaces and Unicode exercise typical Windows measurement paths.
        measurement = Path(folder) / "Sample café"
        measurement.mkdir()
        cube = np.random.default_rng(42).random((12, 10, 12)).astype(np.float32)
        envi.save_image(str(measurement / "sample.hdr"), cube, ext=".raw",
                        metadata={"wavelength": list(range(500, 620, 10))})
        with httpx.Client(base_url=server.url, timeout=90, trust_env=False) as client:
            response = client.get("/")
            response.raise_for_status()
            if '<div id="root"></div>' not in response.text:
                raise RuntimeError("The packaged React interface was not served.")
            # Fetch a real bundled JS file, not only the HTML shell.
            import re
            script = re.search(r'src="([^"]+\.js)"', response.text)
            if script is None:
                raise RuntimeError("No compiled JavaScript was found in the interface.")
            client.get(script.group(1)).raise_for_status()
            client.get("/health").raise_for_status()
            queued = client.get("/api/measurements", params={"folder_path": str(measurement)})
            queued.raise_for_status()
            if not queued.json().get("measurements"):
                raise RuntimeError("The packaged application could not find an ENVI measurement.")
            loaded = client.post("/api/load", data={"folder_path": str(measurement)})
            loaded.raise_for_status()
            if loaded.json().get("shape") != [12, 10, 12]:
                raise RuntimeError(f"ENVI load failed: {loaded.text}")
            client.post("/api/rgb", json={"indices": [8, 4, 1]}).raise_for_status()
            client.post("/api/analysis", json={"method": "pca"}).raise_for_status()
    return {"status": "passed", "checks": ["frontend", "javascript", "ENVI", "RGB", "PCA", "local HTTP"]}


def show_launcher(server, log_dir):
    import tkinter as tk
    from tkinter import messagebox, ttk

    root = tk.Tk()
    root.title("HSI App")
    root.resizable(False, False)
    frame = ttk.Frame(root, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="HSI App is running", font=("Segoe UI", 15, "bold")).pack(anchor="w")
    ttk.Label(frame, text="Keep this window open while working in your browser.").pack(anchor="w", pady=(10, 4))
    ttk.Label(frame, text="Use Stop and exit when you have finished.").pack(anchor="w")
    address = ttk.Entry(frame, width=55)
    address.insert(0, server.url)
    address.configure(state="readonly")
    address.pack(fill="x", pady=16)

    def open_browser():
        if not webbrowser.open(server.url):
            messagebox.showinfo("HSI App", f"Open this address in your browser:\n{server.url}", parent=root)

    def close():
        if messagebox.askokcancel("Stop HSI App", "Stop the app? Any analysis still running will end.", parent=root):
            root.destroy()

    buttons = ttk.Frame(frame)
    buttons.pack(fill="x")
    ttk.Button(buttons, text="Open app", command=open_browser).pack(side="left")
    if sys.platform == "win32":
        ttk.Button(buttons, text="Open logs", command=lambda: os.startfile(log_dir)).pack(side="left", padx=8)
    ttk.Button(buttons, text="Stop and exit", command=close).pack(side="right")
    root.protocol("WM_DELETE_WINDOW", close)

    def check_server():
        if not server.thread.is_alive():
            messagebox.showerror("HSI App stopped", f"The local server stopped. See logs in:\n{log_dir}", parent=root)
            root.destroy()
        else:
            root.after(1000, check_server)

    root.after(250, open_browser)
    root.after(1000, check_server)
    root.mainloop()


def main():
    parser = argparse.ArgumentParser(description="HSI App desktop launcher")
    parser.add_argument("--smoke-test", type=Path, metavar="REPORT_JSON",
                        help="Test the packaged app without opening a browser, then exit.")
    args = parser.parse_args()
    server = None
    report = {"status": "failed"}
    log_dir = None
    try:
        log_dir = configure_logging()
        # Import after logging is configured so frozen startup failures are saved.
        from desktop import LocalServer, create_app
        server = LocalServer(create_app())
        server.start()
        if args.smoke_test:
            report = smoke_test(server)
        else:
            show_launcher(server, log_dir)
        return 0
    except Exception:
        report["error"] = traceback.format_exc()
        logging.exception("HSI App failed")
        if not args.smoke_test:
            message = f"HSI App could not start.\n\nLogs: {log_dir or 'unavailable'}\n\n{report['error']}"
            if sys.platform == "win32":
                import ctypes
                ctypes.windll.user32.MessageBoxW(None, message, "HSI App", 0x10)
            else:
                print(message, file=sys.stderr)
        return 1
    finally:
        if server:
            server.stop()
        if args.smoke_test:
            args.smoke_test.parent.mkdir(parents=True, exist_ok=True)
            args.smoke_test.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    multiprocessing.freeze_support()
    raise SystemExit(main())
