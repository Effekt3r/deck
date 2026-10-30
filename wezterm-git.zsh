# Tells WezTerm which git repo / branch this shell is in.
# Drives the git graph + Claude activity panes. Source from ~/.zshrc.
[[ "$TERM_PROGRAM" == "WezTerm" ]] || return 0

__wez_setvar() {
  printf '\033]1337;SetUserVar=%s=%s\007' "$1" "$(printf '%s' "$2" | base64 | tr -d '\n')"
}

__wez_git_precmd() {
  local root branch
  root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [[ -n $root ]]; then
    branch=$(git branch --show-current 2>/dev/null)
    [[ -z $branch ]] && branch=$(git rev-parse --short HEAD 2>/dev/null)
  fi
  __wez_setvar GIT_REPO "$root"
  __wez_setvar GIT_BRANCH "$branch"
  printf '\033]7;file://%s%s\033\\' "${HOST:-localhost}" "$PWD"   # new tabs open here
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd __wez_git_precmd
