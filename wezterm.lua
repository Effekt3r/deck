-- WezTerm: Claude Code workspace
--   left:   live git branch graph (git repos only)
--   middle: your shell / claude
--   right:  live Claude activity (thinking, replies, tool calls, agents, to-dos)
--   tab 1:  project dashboard — double-click a folder to start Claude there
--
-- Keys (Mac: Cmd, Windows: Ctrl+Shift)
--   Cmd+Shift+G   show/hide the git graph for this tab
--   Cmd+Shift+A   show/hide the Claude activity pane for this tab
--   Cmd+Shift+O   go to the project dashboard
--   Cmd+T         new tab · Cmd+D split right · Cmd+Shift+D split down
--   Cmd+Opt+←/→   move between panes · Shift+Enter newline in Claude

local wezterm = require 'wezterm'
local act = wezterm.action
local mux = wezterm.mux
local config = wezterm.config_builder()

local is_windows = wezterm.target_triple:find('windows') ~= nil
local MOD = is_windows and 'CTRL|SHIFT' or 'CMD'
local MOD_SHIFT = is_windows and 'CTRL|SHIFT' or 'CMD|SHIFT'
local PYTHON = is_windows and { 'python' } or { '/usr/bin/env', 'python3' }
local DIR = wezterm.config_dir
local GRAPH = DIR .. '/git_graph_pane.py'
local ACTIVITY = DIR .. '/claude_activity_pane.py'
local DASHBOARD = DIR .. '/project_dashboard.py'

local GRAPH_SIZE = 0.34     -- share of the space left of the shell
local ACTIVITY_SIZE = 0.30  -- share of the window on the right

-------------------------------------------------------------------- look
config.color_scheme = 'Tokyo Night'
config.font_size = 13
config.line_height = 1.05
config.window_decorations = 'INTEGRATED_BUTTONS|RESIZE'
config.window_padding = { left = 6, right = 6, top = 4, bottom = 2 }
config.inactive_pane_hsb = { saturation = 0.85, brightness = 0.7 }
config.scrollback_lines = 50000
config.tab_max_width = 40
config.initial_cols = 240
config.initial_rows = 60
config.audible_bell = 'Disabled'

if is_windows then
  config.default_prog = { 'powershell.exe', '-NoLogo' }
else
  -- GUI apps on macOS don't see Homebrew's PATH
  config.set_environment_variables = {
    PATH = '/opt/homebrew/bin:/usr/local/bin:' .. (os.getenv('PATH') or '/usr/bin:/bin:/usr/sbin:/sbin'),
  }
end

-------------------------------------------------------------------- side panes
-- per tab: { graph = pane_id, activity = pane_id, repo = path }
local side = {}
local hidden = {}  -- [tab_id] = { graph = true, activity = true } when the user closed one

local function alive(id)
  if not id then return nil end
  local ok, p = pcall(mux.get_pane, id)
  if ok and p then return p end
  return nil
end

local function cmd(script, arg)
  local args = {}
  for _, a in ipairs(PYTHON) do table.insert(args, a) end
  table.insert(args, script)
  table.insert(args, arg)
  return args
end

local function is_tool_pane(pane)
  local v = pane:get_user_vars()
  return v.GIT_GRAPH_PANE == '1'
end

local function close(tab_id, kind)
  local s = side[tab_id]
  if not s then return end
  local p = alive(s[kind])
  s[kind] = nil
  if p then p:send_text('q') end
end

local function open(pane, kind, repo)
  local tab = pane:tab()
  if not tab then return end
  local id = tab:tab_id()
  side[id] = side[id] or {}
  local new
  if kind == 'activity' then
    new = pane:split { direction = 'Right', size = ACTIVITY_SIZE, cwd = repo, args = cmd(ACTIVITY, repo) }
  else
    new = pane:split { direction = 'Left', size = GRAPH_SIZE, cwd = repo, args = cmd(GRAPH, repo) }
  end
  side[id][kind] = new:pane_id()
  side[id].repo = repo
  pane:activate()
end

-- Called whenever a shell prompt reports its repo (see wezterm-git.zsh / .ps1).
local function sync(pane, repo)
  if is_tool_pane(pane) then return end
  local tab = pane:tab()
  if not tab then return end
  if tab:active_pane():pane_id() ~= pane:pane_id() then return end
  local id = tab:tab_id()
  local s = side[id] or {}
  side[id] = s
  hidden[id] = hidden[id] or {}

  for _, kind in ipairs({ 'activity', 'graph' }) do
    local p = alive(s[kind])
    if s[kind] and not p then
      -- the user pressed q in it: keep it closed for this repo
      if s.repo == repo then hidden[id][kind] = true end
      s[kind] = nil
    end
  end

  if repo ~= s.repo then
    hidden[id] = {}
    close(id, 'graph')
    close(id, 'activity')
    s.repo = repo
  end
  if repo == '' then return end
  -- activity first (right), then graph (left) so the shell keeps the middle
  if not s.activity and not hidden[id].activity then open(pane, 'activity', repo) end
  if not s.graph and not hidden[id].graph then open(pane, 'graph', repo) end
end

wezterm.on('user-var-changed', function(window, pane, name, value)
  if name == 'GIT_REPO' then sync(pane, value) end
end)

local function project_of(pane)
  local v = pane:get_user_vars().GIT_REPO
  if v and v ~= '' then return v end
  local cwd = pane:get_current_working_dir()
  if not cwd then return nil end
  local path = type(cwd) == 'userdata' and cwd.file_path or tostring(cwd):gsub('^file://[^/]*', '')
  if is_windows then path = path:gsub('^/(%a:)', '%1') end
  local ok, out = wezterm.run_child_process({ 'git', '-C', path, 'rev-parse', '--show-toplevel' })
  if ok and out ~= '' then return (out:gsub('%s+$', '')) end
  return path
end

local function toggle(kind)
  return wezterm.action_callback(function(window, pane)
    local tab = pane:tab()
    local id = tab:tab_id()
    side[id] = side[id] or {}
    hidden[id] = hidden[id] or {}
    if alive(side[id][kind]) then
      close(id, kind)
      hidden[id][kind] = true
      return
    end
    hidden[id][kind] = nil
    if is_tool_pane(pane) then return end
    local repo = project_of(pane)
    if not repo then return end
    if kind == 'graph' and not pane:get_user_vars().GIT_REPO then
      local ok = wezterm.run_child_process({ 'git', '-C', repo, 'rev-parse', '--git-dir' })
      if not ok then
        window:toast_notification('Git graph', 'Not inside a git repository', nil, 3000)
        return
      end
    end
    open(pane, kind, repo)
  end)
end

-------------------------------------------------------------------- dashboard
local dashboard_pane

local function goto_dashboard(window)
  local p = alive(dashboard_pane)
  if p then
    p:tab():activate()
    return
  end
  local tab, pane = window:mux_window():spawn_tab { args = cmd(DASHBOARD, '') }
  dashboard_pane = pane:pane_id()
  tab:set_title('⌂ Projects')
  tab:activate()
end

wezterm.on('gui-startup', function(cmd_args)
  local launched_with_args = cmd_args and cmd_args.args
  local tab, pane, window = mux.spawn_window(launched_with_args and cmd_args or { args = cmd(DASHBOARD, '') })
  if not launched_with_args then
    dashboard_pane = pane:pane_id()
    tab:set_title('⌂ Projects')
  end
end)

-------------------------------------------------------------------- tab titles
local function basename(p) return (p or ''):match('([^/\\]+)[/\\]*$') or p end

wezterm.on('format-tab-title', function(tab, tabs, panes, cfg, hover, max_width)
  local pane = tab.active_pane
  local vars = pane.user_vars or {}
  local title
  if tab.tab_title and tab.tab_title ~= '' then
    title = tab.tab_title
  elseif vars.GIT_REPO and vars.GIT_REPO ~= '' then
    title = basename(vars.GIT_REPO)
    local proc = basename(pane.foreground_process_name or '')
    if proc == 'claude' or proc == 'node' or pane.title:find('✳') then
      title = title .. ' · ' .. pane.title          -- Claude's own status title
    elseif vars.GIT_BRANCH and vars.GIT_BRANCH ~= '' then
      title = title .. ' ⎇ ' .. vars.GIT_BRANCH
    end
  else
    title = pane.title
  end
  return ' ' .. (tab.tab_index + 1) .. ' ' .. wezterm.truncate_right(title, max_width - 5) .. ' '
end)

-------------------------------------------------------------------- keys
config.keys = {
  { key = 'g', mods = MOD_SHIFT, action = toggle('graph') },
  { key = 'a', mods = MOD_SHIFT, action = toggle('activity') },
  { key = 'o', mods = MOD_SHIFT, action = wezterm.action_callback(function(w) goto_dashboard(w) end) },
  { key = 'd', mods = MOD, action = act.SplitHorizontal { domain = 'CurrentPaneDomain' } },
  { key = 'd', mods = is_windows and 'CTRL|SHIFT|ALT' or 'CMD|SHIFT', action = act.SplitVertical { domain = 'CurrentPaneDomain' } },
  { key = 'LeftArrow', mods = is_windows and 'CTRL|ALT' or 'CMD|OPT', action = act.ActivatePaneDirection 'Left' },
  { key = 'RightArrow', mods = is_windows and 'CTRL|ALT' or 'CMD|OPT', action = act.ActivatePaneDirection 'Right' },
  { key = 'UpArrow', mods = is_windows and 'CTRL|ALT' or 'CMD|OPT', action = act.ActivatePaneDirection 'Up' },
  { key = 'DownArrow', mods = is_windows and 'CTRL|ALT' or 'CMD|OPT', action = act.ActivatePaneDirection 'Down' },
  { key = 'k', mods = MOD, action = act.ClearScrollback 'ScrollbackAndViewport' },
  -- newline inside Claude Code's prompt
  { key = 'Enter', mods = 'SHIFT', action = act.SendString '\x1b\r' },
}

return config
