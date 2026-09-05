param([string]$PythonVersion = '3.13')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonExecutable = Join-Path $PSScriptRoot 'depthwizard_person5\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    & py "-$PythonVersion" -m venv depthwizard_person5/.venv
    if ($LASTEXITCODE -ne 0) { throw "Install Python $PythonVersion with the Python launcher, then retry." }
}
& $pythonExecutable -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'pip upgrade failed.' }
& $pythonExecutable -m pip install -c constraints-tested.txt -r depthwizard_person5/requirements.txt -r depthwizard_person5/requirements-pipeline.txt httpx
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Keep this terminal output for diagnosis.' }
& $pythonExecutable -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Python dependency conflicts were detected.' }
foreach ($module in @('depthwizard_person4', 'depthwizard_person6')) {
    & npm.cmd --prefix $module install
    if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed for $module. Install Node.js 22.12+ with npm." }
}
foreach ($module in @('depthwizard_person4', 'depthwizard_person5')) {
    $destination = Join-Path $PSScriptRoot "$module\.env"
    if (-not (Test-Path -LiteralPath $destination)) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "$module\.env.example") -Destination $destination
    }
}
& $pythonExecutable scripts/diagnose.py
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed. Read the diagnostic output above.' }
Write-Host 'Setup complete. Run diagnose.cmd --model once to download/test the model, then start_depthwizard.cmd.'
