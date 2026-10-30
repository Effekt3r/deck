# Deck: at every prompt, report the cwd (OSC 7) and the git repo and branch
# (OSC 1337 SetUserVar). Same protocol as the WezTerm prototype.
__deck_setvar() {
  printf '\033]1337;SetUserVar=%s=%s\007' "$1" "$(printf '%s' "$2" | base64 | tr -d '\n')"
}
__deck_precmd() {
  local root branch
  root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [[ -n $root ]]; then
    branch=$(git branch --show-current 2>/dev/null)
    [[ -z $branch ]] && branch=$(git rev-parse --short HEAD 2>/dev/null)
  fi
  __deck_setvar GIT_REPO "$root"
  __deck_setvar GIT_BRANCH "$branch"
  printf '\033]7;file://%s%s\033\\' "${HOST:-localhost}" "${${PWD//\%/%25}// /%20}"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __deck_precmd
