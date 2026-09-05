param([int]$Port = 8000, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonExecutable = Join-Path $PSScriptRoot 'depthwizard_person5\.venv\Scripts\python.exe'
$frontendDirectory = Join-Path $PSScriptRoot 'depthwizard_person4'
$viteEntry = Join-Path $frontendDirectory 'node_modules\vite\bin\vite.js'
$url = "http://127.0.0.1:$Port"
$logDirectory = Join-Path $PSScriptRoot '.local-archive\launcher'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Test-Ready {
    try {
        $health = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 2
        $page = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
        return $health.service -eq 'DepthWizard Backend' -and $page.Content.Contains('<div id="root">')
    } catch { return $false }
}

if (Test-Ready) {
    Write-Host "DepthWizard is already running at $url"
    if (-not $NoBrowser) { Start-Process -FilePath $url -WindowStyle Hidden }
    exit 0
}

if (-not (Test-Path -LiteralPath $pythonExecutable) -or -not (Test-Path -LiteralPath $viteEntry)) {
    Write-Host 'First launch: installing project dependencies. This requires Python 3.13, Node.js 22.12+ and internet.'
    & (Join-Path $PSScriptRoot 'setup.ps1')
}
# Re-run setup after dependency definitions change or a previous setup failed.
$marker = Join-Path $logDirectory 'dependencies.txt'
$dependencyFiles = @('constraints-tested.txt','depthwizard_person1/requirements.txt','depthwizard_person2/requirements.txt','depthwizard_person3/requirements.txt','depthwizard_person5/requirements.txt','depthwizard_person5/requirements-pipeline.txt','depthwizard_person4/package.json','depthwizard_person6/package.json')
$fingerprint = ($dependencyFiles | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $_)).Hash }) -join ':'
if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $fingerprint) {
    Write-Host 'Checking installed dependencies...'
    # Existing installations are checked before deciding whether installation is necessary.
    & $pythonExecutable scripts/diagnose.py
    if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $marker)) { & (Join-Path $PSScriptRoot 'setup.ps1') }
    Set-Content -LiteralPath $marker -Value $fingerprint
}
Write-Host 'Checking the depth model. The first launch may download weights; please keep this window open.'
& $pythonExecutable scripts/diagnose.py --model
if ($LASTEXITCODE -ne 0) { throw 'Model check failed. See .local-archive/diagnostics/person2-check.log. Check internet access before retrying.' }

Write-Host 'Preparing the website...'
$oldApi = $env:VITE_API_BASE_URL
$oldMock = $env:VITE_USE_MOCK_API
try {
    $env:VITE_API_BASE_URL = '/'
    $env:VITE_USE_MOCK_API = 'false'
    Push-Location -LiteralPath $frontendDirectory
    & node $viteEntry build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally {
    Pop-Location
    $env:VITE_API_BASE_URL = $oldApi
    $env:VITE_USE_MOCK_API = $oldMock
}

$server = Start-Process -FilePath $pythonExecutable -WorkingDirectory (Join-Path $PSScriptRoot 'depthwizard_person5') -ArgumentList @('-m','uvicorn','main:app','--host','127.0.0.1','--port',"$Port") -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'backend.stdout.log') -RedirectStandardError (Join-Path $logDirectory 'backend.stderr.log')
$deadline = [DateTime]::UtcNow.AddSeconds(60)
while ([DateTime]::UtcNow -lt $deadline) {
    if ($server.HasExited) { throw 'Server could not start. Check .local-archive/launcher/backend.stderr.log; the port may already be occupied.' }
    if (Test-Ready) {
        Write-Host "Ready: $url - frontend and API are served together."
        if (-not $NoBrowser) { Start-Process -FilePath $url -WindowStyle Hidden }
        exit 0
    }
    Start-Sleep -Milliseconds 500
}
Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
throw 'Startup timed out. See .local-archive/launcher/backend.stderr.log.'
