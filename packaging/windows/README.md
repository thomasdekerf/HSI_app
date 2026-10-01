# Build the Windows installer

This packages the HSI **analysis** app (FastAPI + React) for Windows 10/11 x64.
It includes Python, the analysis libraries, the built browser interface, a launcher,
Start menu/desktop shortcuts, and an uninstaller. The user of the installed app
does not need Python, Node.js, Git, PyCharm, or an internet connection.

Measurement files and the separate camera acquisition application are not included.
Build on an Intel/AMD Windows PC, or use the included GitHub Windows workflow.

## 1. Install the build tools once

Install these **on the PC that creates the installer**:

1. **[Python 3.12, Windows installer (64-bit)](https://www.python.org/downloads/release/python-31210/)**.
   Keep the Python launcher, pip, and Tcl/Tk selected; enable **Add python.exe to PATH**.
   Use the full installer, not the embeddable ZIP. Other Python 3.12 patch versions
   are supported; the build script checks the minor version and x64 architecture.
2. **[Node.js 22 or 24 LTS, Windows x64 installer](https://nodejs.org/en/download)**,
   including npm. The GitHub workflow uses Node.js 22.
3. **[Inno Setup 6](https://jrsoftware.org/isdl.php)**, version 6.3 or newer,
   using the default installation location. You do not need to open its editor.

Restart any open terminal windows after installing. Allow several GB of free disk
space for dependencies and temporary build files. Internet access is needed for
the initial dependency downloads; Visual Studio/C++ build tools are not required.

## 2. Download the project

Open the [Windows installer branch](https://github.com/thomasdekerf/HSI_app/tree/codex/windows-installer)
on GitHub. Select **Code → Download ZIP**, then **Extract all** into a local folder
such as `C:\HSI_app`. Do not run the build from inside the ZIP.

Alternatively, if Git is installed:

```powershell
git clone --branch codex/windows-installer https://github.com/thomasdekerf/HSI_app.git
cd HSI_app
```

After this branch is merged, the default branch will contain the same build tools.

## 3. Build

Double-click **build_windows.bat** in the extracted project folder.

The script checks the tools, recreates `.venv-build`, installs the pinned Python
dependencies and locked npm dependencies, runs the Python and React tests, builds
the interface, bundles the Windows app, and runs a smoke test **inside the actual
executable** before compiling the installer. The smoke test loads synthetic ENVI
data from a path containing spaces and Unicode, serves the built JavaScript,
and exercises RGB and PCA through the local HTTP API. It also checks bundled Tcl/Tk.

Wait for the green `SUCCESS` message. The output is:

```text
dist\installer\HSI-App-Setup-0.1.0.exe
dist\installer\HSI-App-Setup-0.1.0.exe.sha256
```

The `.exe` is the single file to copy to other laptops. The `.sha256` file is an
optional integrity checksum. This is an unsigned installer; signing is not
configured. Organization-managed PCs may require IT approval for unsigned apps.

From PowerShell, you can instead run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\packaging\windows\build.ps1
```

The execution-policy setting applies only to this build process.

## 4. Install and use

1. Close any running HSI App launcher, then run `HSI-App-Setup-0.1.0.exe`.
2. Install for the current user. The default is `%LOCALAPPDATA%\Programs\HSI App`;
   the app installer does not request administrator rights.
3. Open **HSI App** from the desktop or Start menu. It opens your default browser
   automatically. **Open app** in the launcher reopens the interface if needed.
4. Copy your complete measurement folders separately, including `.hdr`, raw image
   files, dark/white reference files, and saved annotation/ROI/registration JSON
   files. Preserve their subfolder structure. Use a writable folder, such as
   Documents or an external drive, and enter its Windows path in **Dataset folder path**.
5. Keep the launcher window open while working. Closing the browser tab does not
   stop the backend. Use **Stop and exit** in the launcher after saving your work.

The app runs only on `127.0.0.1`, chooses an available port, and uses a single local
server for the interface and API. Each launch starts a separate analysis session.
Browser-only state from another computer is not transferred. No measurement data
is uploaded by the launcher or installer. Uninstall through Windows **Installed apps**;
measurement folders remain untouched.

## Build on GitHub instead

The **Build Windows installer** workflow runs on relevant pull requests and pushes
to `master`. Once the workflow is on the default branch, it can also be started
from **Actions → Build Windows installer → Run workflow**.

Open a successful run and download its **HSI-App-Windows-installer** artifact while
signed into GitHub. Extract it to find the installer, checksum, dependency list,
and smoke-test reports. GitHub additionally tests installing the app into a path
with spaces, launching the installed executable, and uninstalling it. Artifacts
have GitHub's configured retention period; keep a local copy of an installer you need.

## Troubleshooting and advanced options

- **Python not found or wrong version:** run `py -3.12 --version`, or specify
  `-PythonExe "C:\full\path\to\python.exe"` when invoking `build.ps1`.
- **npm not found:** reinstall Node.js with npm and PATH integration, then reopen
  the terminal or run `build_windows.bat` again.
- **Inno Setup not found:** pass
  `-InnoSetupCompiler "C:\full\path\to\ISCC.exe"`.
- **Build failed:** the script stops on the first failed command. Read that error;
  do not distribute an older installer left in `dist`. Close running copies of
  `dist\HSI-App\HSI-App.exe` before rebuilding.
- **App fails to start:** use **Open logs**, or inspect
  `%LOCALAPPDATA%\HSI-App\logs\app.log` and `console.log`. The build's executable
  validation report is `dist\smoke-test.json`.
- **Portable folder instead of installer:** pass `-SkipInstaller`. Copy the
  **entire** `dist\HSI-App` directory; the `.exe` needs its `_internal` folder.
- **Change installer version:** pass `-Version 0.1.1`. Keep the installer AppId
  unchanged so subsequent installers update the same application.
- **Development:** `npm start` still talks to the backend on port 8000. A production
  frontend build uses `/api` and must be served by `backend/desktop_launcher.py`.
  On a configured development machine, run `python backend/desktop_launcher.py`
  after `npm run build` in `frontend` (Tk is required for its launcher window).

The build files are `build.ps1` (orchestration), `requirements-build.txt` (pinned
dependencies), `hsi_app.spec` (PyInstaller), and `installer.iss` (Inno Setup).
Update pins deliberately and validate on Windows before distributing a new build.
