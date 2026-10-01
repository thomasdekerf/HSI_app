[CmdletBinding()]
param(
    [string]$PythonExe = "",
    [string]$InnoSetupCompiler = "",
    [string]$Version = "0.1.0",
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed (exit $LASTEXITCODE): $Program $($Arguments -join ' ')"
    }
}

function Test-PackagedApp {
    param([string]$Executable, [string]$Report)
    if (Test-Path $Report) { Remove-Item $Report }
    $process = Start-Process -FilePath $Executable -ArgumentList "--smoke-test `"$Report`"" -PassThru
    $null = $process.Handle # Keep the exit code available in Windows PowerShell 5.1.
    if (-not $process.WaitForExit(180000)) {
        Stop-Process -Id $process.Id -Force
        throw "The packaged smoke test timed out. Check $env:LOCALAPPDATA\HSI-App\logs."
    }
    # Refresh the Process object after waiting (including windowed executables).
    $process.Refresh()
    if (-not (Test-Path $Report)) { throw "The packaged app did not produce a smoke-test report." }
    $result = Get-Content $Report -Raw | ConvertFrom-Json
    if ($process.ExitCode -ne 0 -or $result.status -ne "passed") {
        Get-Content $Report
        throw "The packaged app failed its smoke test."
    }
    Write-Host "Packaged app smoke test passed."
}

if ($env:OS -ne "Windows_NT") { throw "Build the Windows executable on Windows." }
if ($Version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { throw "Version must look like 0.1.0." }

if (-not $PythonExe) {
    if (Get-Command py.exe -ErrorAction SilentlyContinue) {
        $PythonExe = & py.exe -3.12 -c "import sys; print(sys.executable)"
        if ($LASTEXITCODE -ne 0) { throw "Install Python 3.12 x64, or pass -PythonExe with its full path." }
    } elseif (Get-Command python.exe -ErrorAction SilentlyContinue) {
        $PythonExe = (Get-Command python.exe).Source
    } else {
        throw "Python was not found. Install Python 3.12 x64 with Tcl/Tk and the Python launcher."
    }
}
Invoke-Checked $PythonExe @("-c", "import sys, platform, tkinter; assert sys.version_info[:2] == (3, 12) and platform.machine().lower() in ('amd64', 'x86_64'), 'Use Python 3.12 x64'; print(sys.version)")

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
Invoke-Checked "node.exe" @("-e", "if (![22,24].includes(Number(process.versions.node.split('.')[0]))) { throw Error('Use Node.js 22 or 24 LTS'); } console.log(process.version)")

if (-not $SkipInstaller) {
    if (-not $InnoSetupCompiler) {
        $compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
        if ($compiler) { $InnoSetupCompiler = $compiler.Source }
    }
    if (-not $InnoSetupCompiler) {
        $candidates = @(
            "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
            "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
            "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
        )
        foreach ($candidate in $candidates) {
            if (Test-Path $candidate) { $InnoSetupCompiler = $candidate; break }
        }
    }
    if (-not $InnoSetupCompiler -or -not (Test-Path $InnoSetupCompiler)) {
        throw "Install Inno Setup 6.3 or newer, or pass -InnoSetupCompiler with the full ISCC.exe path."
    }
}

Push-Location $repoRoot
$savedCI = $env:CI
$savedSourceMaps = $env:GENERATE_SOURCEMAP
$savedNodeOptions = $env:NODE_OPTIONS
try {
    Write-Host "Creating the isolated Python build environment..."
    Invoke-Checked $PythonExe @("-m", "venv", "--clear", ".venv-build")
    $buildPython = Join-Path $repoRoot ".venv-build\Scripts\python.exe"
    Invoke-Checked $buildPython @("-m", "pip", "install", "-r", "packaging/windows/requirements-build.txt")
    Invoke-Checked $buildPython @("-m", "pip", "check")
    Invoke-Checked $buildPython @("-m", "pytest", "backend", "-q")

    Push-Location (Join-Path $repoRoot "frontend")
    try {
        $env:CI = "true"
        $env:NODE_OPTIONS = "--max-old-space-size=4096"
        Invoke-Checked $npm @("ci", "--no-audit", "--no-fund")
        Invoke-Checked $npm @("test", "--", "--watchAll=false", "--runInBand")
        # Existing frontend lint warnings are reported, without failing packaging.
        $env:CI = "false"
        $env:GENERATE_SOURCEMAP = "false"
        Invoke-Checked $npm @("run", "build")
    } finally { Pop-Location }

    Write-Host "Bundling Python, the analysis libraries, and the interface..."
    Invoke-Checked $buildPython @("-m", "PyInstaller", "--noconfirm", "--clean", "packaging/windows/hsi_app.spec")
    $executable = Join-Path $repoRoot "dist\HSI-App\HSI-App.exe"
    Test-PackagedApp $executable (Join-Path $repoRoot "dist\smoke-test.json")
    & $buildPython -m pip freeze | Out-File (Join-Path $repoRoot "dist\build-environment.txt") -Encoding utf8

    if (-not $SkipInstaller) {
        Write-Host "Creating the installer..."
        Invoke-Checked $InnoSetupCompiler @("/DAppVersion=$Version", "packaging/windows/installer.iss")
        $installer = Join-Path $repoRoot "dist\installer\HSI-App-Setup-$Version.exe"
        if (-not (Test-Path $installer)) { throw "The installer was not produced." }
        $hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $(Split-Path $installer -Leaf)" | Out-File "$installer.sha256" -Encoding ascii
        Write-Host "SUCCESS: $installer" -ForegroundColor Green
    } else {
        Write-Host "SUCCESS: $executable (keep the entire HSI-App folder together)" -ForegroundColor Green
    }
} finally {
    $env:CI = $savedCI
    $env:GENERATE_SOURCEMAP = $savedSourceMaps
    $env:NODE_OPTIONS = $savedNodeOptions
    Pop-Location
}
