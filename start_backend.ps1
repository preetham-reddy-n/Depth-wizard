$ErrorActionPreference = "Stop"

$backendDirectory = Join-Path $PSScriptRoot "depthwizard_person5"
$pythonExecutable = Join-Path $backendDirectory ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $pythonExecutable -PathType Leaf)) {
    throw "Backend environment is missing. Create depthwizard_person5\.venv and install requirements.txt plus requirements-pipeline.txt."
}

if (-not $env:MAX_UPLOAD_SIZE_MB) {
    $env:MAX_UPLOAD_SIZE_MB = "500"
}

Set-Location -LiteralPath $backendDirectory
Write-Host "DepthWizard backend: http://127.0.0.1:8000 (upload limit: $env:MAX_UPLOAD_SIZE_MB MB)"
& $pythonExecutable -c "import torch; print('CUDA available: ' + str(torch.cuda.is_available()) + '; actual device is controlled by DEPTH_DEVICE in .env')"
if ($LASTEXITCODE -ne 0) { throw 'PyTorch could not be imported. Run setup.cmd or diagnose.cmd from the project root.' }
& $pythonExecutable -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
