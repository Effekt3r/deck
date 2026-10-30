# Tells WezTerm which git repo / branch this shell is in.
# Drives the git graph + Claude activity panes. Dot-source from $PROFILE.
if ($env:TERM_PROGRAM -ne 'WezTerm') { return }

function global:__WezSetVar([string]$Name, [string]$Value) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
  [Console]::Write("$([char]27)]1337;SetUserVar=$Name=$b64$([char]7)")
}

if (-not $global:__WezOrigPrompt) { $global:__WezOrigPrompt = $function:prompt }

function global:prompt {
  $ok = $?; $code = $global:LASTEXITCODE
  $root = ''; $branch = ''
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $root = (git rev-parse --show-toplevel 2>$null)
    if ($root) {
      $branch = (git branch --show-current 2>$null)
      if (-not $branch) { $branch = (git rev-parse --short HEAD 2>$null) }
    }
  }
  __WezSetVar 'GIT_REPO' "$root"
  __WezSetVar 'GIT_BRANCH' "$branch"
  $p = $PWD.ProviderPath -replace '\\', '/'
  [Console]::Write("$([char]27)]7;file://$env:COMPUTERNAME/$p$([char]27)\")
  $global:LASTEXITCODE = $code
  & $global:__WezOrigPrompt
}
