"""Local server used by the Windows launcher and its packaged smoke test."""
from pathlib import Path
import socket
import sys
import threading
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
import uvicorn

from main import app as analysis_app


def frontend_directory():
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "frontend_build"
    return Path(__file__).resolve().parents[1] / "frontend" / "build"


def create_app(frontend_dir=None):
    frontend_dir = Path(frontend_dir) if frontend_dir else frontend_directory()
    if not (frontend_dir / "index.html").is_file():
        raise FileNotFoundError("The interface is missing. Build frontend with npm run build first.")

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1"])

    @app.middleware("http")
    async def same_origin_only(request: Request, call_next):
        # The analysis API can read/write local measurement files. An unrelated
        # website must not be able to call it through the user's browser.
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"error": "Cross-origin requests are not allowed."}, status_code=403)
        return await call_next(request)

    @app.get("/health")
    def health():
        return {"application": "HSI-App", "status": "ready"}

    app.mount("/api", analysis_app)
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
    return app


class LocalServer:
    """Reserve a free loopback port before starting, avoiding port conflicts."""

    def __init__(self, app):
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.bind(("127.0.0.1", 0))
        self.url = f"http://127.0.0.1:{self.socket.getsockname()[1]}"
        self.server = uvicorn.Server(uvicorn.Config(
            app, loop="asyncio", http="h11", ws="none", log_config=None,
            access_log=False, timeout_graceful_shutdown=5,
        ))
        self.error = None
        self.thread = threading.Thread(target=self._run, name="hsi-server", daemon=True)

    def _run(self):
        try:
            self.server.run(sockets=[self.socket])
        except BaseException as exc:
            self.error = exc

    def start(self, timeout=30):
        self.thread.start()
        deadline = time.monotonic() + timeout
        while not self.server.started:
            if self.error or not self.thread.is_alive():
                raise RuntimeError("The local server could not start.") from self.error
            if time.monotonic() >= deadline:
                raise TimeoutError("The local server took too long to start.")
            time.sleep(0.05)

    def stop(self):
        self.server.should_exit = True
        if self.thread.is_alive():
            self.thread.join(timeout=7)
        self.socket.close()
