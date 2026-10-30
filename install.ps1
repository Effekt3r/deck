# Windows installer: WezTerm + Claude workspace config.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $HOME '.config\wezterm'

if (-not (Get-Command wezterm -ErrorAction SilentlyContinue) -and -not (Test-Path "$env:ProgramFiles\WezTerm\wezterm.exe")) {
  winget install --id wez.wezterm -e --accept-source-agreements --accept-package-agreements
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
$stamp = Get-Date -Format yyyyMMddHHmmss
foreach ($f in 'wezterm.lua','git_graph_pane.py','claude_activity_pane.py','project_dashboard.py','wezterm-git.ps1') {
  $target = Join-Path $dest $f
  if (Test-Path $target) { Copy-Item $target "$target.bak.$stamp" }
  Copy-Item (Join-Path $here $f) $target -Force
}
$pj = Join-Path $dest 'projects.json'
if (-not (Test-Path $pj)) { Copy-Item (Join-Path $here 'projects.windows.json') $pj }

if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Force -Path $PROFILE | Out-Null }
if (-not (Select-String -Path $PROFILE -Pattern 'wezterm-git.ps1' -Quiet)) {
  Add-Content $PROFILE "`n# WezTerm: git graph + Claude activity panes`n. `"$dest\wezterm-git.ps1`""
}
Write-Host 'Done. Open WezTerm.'
