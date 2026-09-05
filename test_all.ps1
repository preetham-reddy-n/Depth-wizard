$ErrorActionPreference = "Stop"

$pythonExecutable = Join-Path $PSScriptRoot "depthwizard_person5\.venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonExecutable -PathType Leaf)) {
    throw "Backend environment is missing. Install the Person 5 web and pipeline requirements first."
}

foreach ($module in @("depthwizard_person1", "depthwizard_person2", "depthwizard_person3", "depthwizard_person5")) {
    Push-Location -LiteralPath (Join-Path $PSScriptRoot $module)
    try {
        Write-Host "Testing $module"
        & $pythonExecutable -m pytest tests -q
        if ($LASTEXITCODE -ne 0) { throw "$module tests failed with exit code $LASTEXITCODE." }
    }
    finally {
        Pop-Location
    }
}

Push-Location -LiteralPath (Join-Path $PSScriptRoot "depthwizard_person6")
try {
    Write-Host "Testing 3D renderer"
    & node --test
    if ($LASTEXITCODE -ne 0) { throw "3D renderer tests failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}

Push-Location -LiteralPath (Join-Path $PSScriptRoot "depthwizard_person4")
try {
    Write-Host "Building integrated frontend"
    & node node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}

Write-Host "All DepthWizard checks passed."

