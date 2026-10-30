# Deck: at every prompt, report the cwd (OSC 7) and the git repo and branch
# (OSC 1337 SetUserVar). Dot-sourced after the user's profile.
function global:__DeckSetVar([string]$Name, [string]$Value) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
  [Console]::Write("$([char]27)]1337;SetUserVar=$Name=$b64$([char]7)")
}

if (-not $global:__DeckOrigPrompt) { $global:__DeckOrigPrompt = $function:prompt }

function global:prompt {
  $ok = $global:?; $code = $global:LASTEXITCODE
  $root = ''; $branch = ''
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $root = (git rev-parse --show-toplevel 2>$null)
    if ($root) {
      $branch = (git branch --show-current 2>$null)
      if (-not $branch) { $branch = (git rev-parse --short HEAD 2>$null) }
    }
  }
  __DeckSetVar 'GIT_REPO' "$root"
  __DeckSetVar 'GIT_BRANCH' "$branch"
  $p = (($PWD.ProviderPath -replace '\\', '/') -replace '%', '%25') -replace ' ', '%20'
  [Console]::Write("$([char]27)]7;file://$env:COMPUTERNAME/$p$([char]27)\")
  $global:LASTEXITCODE = $code
  # The git calls above reset $?; prompts like starship show it, so put it back.
  if (-not $ok) { Write-Error 'failed' -ErrorAction Ignore }
  & $global:__DeckOrigPrompt
}
