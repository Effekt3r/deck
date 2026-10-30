#!/usr/bin/env bash
# macOS installer: WezTerm + Claude workspace config.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/.config/wezterm"

if [ ! -d /Applications/WezTerm.app ]; then
  command -v brew >/dev/null || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
  brew install --cask wezterm
fi
command -v python3 >/dev/null || { echo "python3 is needed (xcode-select --install)"; exit 1; }

mkdir -p "$dest"
stamp=$(date +%Y%m%d%H%M%S)
for f in wezterm.lua git_graph_pane.py claude_activity_pane.py project_dashboard.py wezterm-git.zsh; do
  if [ -f "$dest/$f" ] && ! cmp -s "$here/$f" "$dest/$f"; then cp "$dest/$f" "$dest/$f.bak.$stamp"; fi
  cp "$here/$f" "$dest/$f"
done
[ -f "$dest/projects.json" ] || cp "$here/projects.json" "$dest/projects.json"

if [ -f "$HOME/.wezterm.lua" ]; then
  echo "Note: ~/.wezterm.lua exists and takes priority — renaming it to ~/.wezterm.lua.bak.$stamp"
  mv "$HOME/.wezterm.lua" "$HOME/.wezterm.lua.bak.$stamp"
fi

line='[[ -f ~/.config/wezterm/wezterm-git.zsh ]] && source ~/.config/wezterm/wezterm-git.zsh'
if ! grep -qF 'wezterm-git.zsh' "$HOME/.zshrc" 2>/dev/null; then
  printf '\n# WezTerm: git graph + Claude activity panes\n%s\n' "$line" >> "$HOME/.zshrc"
fi
echo "Done. Open WezTerm."
