# Build on Windows with Python 3.12 x64. The one-folder app is wrapped by Inno Setup.
from pathlib import Path

root = Path(SPECPATH).resolve().parents[1]
frontend = root / "frontend" / "build"
if not (frontend / "index.html").is_file():
    raise SystemExit("Build frontend with npm run build before running PyInstaller.")

a = Analysis(
    [str(root / "backend" / "desktop_launcher.py")],
    pathex=[str(root / "backend")],
    binaries=[],
    datas=[(str(frontend), "frontend_build")],
    hiddenimports=["uvicorn.logging", "uvicorn.loops.asyncio",
                   "uvicorn.protocols.http.h11_impl", "uvicorn.lifespan.on"],
    hookspath=[],
    hooksconfig={"matplotlib": {"backends": ["Agg"]}},
    runtime_hooks=[],
    excludes=["pytest", "IPython", "notebook"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="HSI-App",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="HSI-App")
