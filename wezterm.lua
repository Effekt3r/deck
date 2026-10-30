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
config.tab_max_width = 60  -- repo name + Claude's session title
-- tab titles use ⌂ ⎇ ✳; name a symbol font so they don't render as boxes
config.window_frame = {
  font = wezterm.font_with_fallback { { family = 'Roboto', weight = 'Bold' },
                                      is_windows and 'Segoe UI Symbol' or 'Apple Symbols' },
}
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
-- Tool panes (graph, activity, dashboard) set user var GIT_GRAPH_PANE=1 so they
-- are never treated as shells. The side panes also set SIDE_PANE=graph|activity
-- and SIDE_REPO=<repo>, so they can be found again after a config reload (which
-- resets these tables) or when the dashboard opened them.
-- per tab: { graph = pane_id, activity = pane_id, repo = GIT_REPO, shell = pane_id }
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

-- The tab's shell: the pane sync() last saw, else (e.g. after a reload)
-- whichever pane isn't a tool pane.
local function shell_of(tab_id)
  local p = alive((side[tab_id] or {}).shell)
  if p then return p end
  local ok, tab = pcall(mux.get_tab, tab_id)
  if not ok or not tab then return nil end
  for _, q in ipairs(tab:panes()) do
    if not is_tool_pane(q) then return q end
  end
  return nil
end

-- side panes in the tab: { { kind = 'graph', id = 12, repo = '/x' }, … }
local function scan(tab)
  local found = {}
  for _, p in ipairs(tab:panes()) do
    local v = p:get_user_vars()
    if v.SIDE_PANE == 'graph' or v.SIDE_PANE == 'activity' then
      table.insert(found, { kind = v.SIDE_PANE, id = p:pane_id(), repo = v.SIDE_REPO })
    end
  end
  return found
end

-- The tab's state. The first time this config sees a tab (e.g. after a
-- reload) it adopts the side panes already open there for `repo`.
local function state(tab, repo)
  local id = tab:tab_id()
  if not side[id] then
    local s = { repo = repo }
    for _, f in ipairs(scan(tab)) do
      if not s[f.kind] and (f.repo == repo or repo == '') then s[f.kind] = f.id end
    end
    side[id] = s
  end
  hidden[id] = hidden[id] or {}
  return side[id], hidden[id]
end

-- Ask every side pane in the tab to quit (they exit on `q`); returns their ids.
local function close_all(tab, s)
  local ids = {}
  local function quit(p)
    if p and not ids[p:pane_id()] then
      ids[p:pane_id()] = true
      p:send_text('q')
    end
  end
  quit(alive(s.graph))
  quit(alive(s.activity))
  for _, f in ipairs(scan(tab)) do quit(alive(f.id)) end
  s.graph, s.activity = nil, nil
  return ids
end

-- Run fn once the panes in `ids` have exited, so new splits are sized against
-- the whole width (q is handled within ~0.3 s; stop waiting after 3 s).
local function when_closed(ids, fn, tries)
  tries = tries or 0
  for id in pairs(ids) do
    if alive(id) and tries < 30 then
      wezterm.time.call_after(0.1, function() when_closed(ids, fn, tries + 1) end)
      return
    end
  end
  fn()
end

local function open(pane, kind, repo)
  local tab = pane:tab()
  if not tab then return end
  local new
  if kind == 'activity' then
    new = pane:split { direction = 'Right', size = ACTIVITY_SIZE, cwd = repo, args = cmd(ACTIVITY, repo) }
  else
    new = pane:split { direction = 'Left', size = GRAPH_SIZE, cwd = repo, args = cmd(GRAPH, repo) }
  end
  side[tab:tab_id()][kind] = new:pane_id()
  pane:activate()
end

-- open the side panes this tab should have for `repo`
local function fill(pane, repo)
  if repo == '' or not alive(pane:pane_id()) then return end
  local tab = pane:tab()
  if not tab then return end
  local s, h = state(tab, repo)
  if s.repo ~= repo then return end
  -- activity first (right), then graph (left) so the shell keeps the middle
  if not alive(s.activity) and not h.activity then open(pane, 'activity', repo) end
  if not alive(s.graph) and not h.graph then open(pane, 'graph', repo) end
end

-- Called whenever a shell prompt reports its repo (see wezterm-git.zsh / .ps1).
local function sync(pane, repo)
  if is_tool_pane(pane) then return end
  local tab = pane:tab()
  if not tab then return end
  if tab:active_pane():pane_id() ~= pane:pane_id() then return end
  local id = tab:tab_id()
  local s, h = state(tab, repo)
  s.shell = pane:pane_id()
  if s.closing then  -- old panes are still quitting; fill() runs when they're gone
    s.repo = repo
    return
  end

  for _, kind in ipairs({ 'activity', 'graph' }) do
    if s[kind] and not alive(s[kind]) then
      -- the user pressed q in it: keep it closed for this repo
      if s.repo == repo then h[kind] = true end
      s[kind] = nil
    end
  end

  if repo ~= s.repo then
    hidden[id] = {}
    s.repo = repo
    local ids = close_all(tab, s)
    if next(ids) then
      s.closing = true
      when_closed(ids, function()
        s.closing = nil
        fill(pane, s.repo)
      end)
      return
    end
  end
  fill(pane, repo)
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
    if not tab then return end
    if is_tool_pane(pane) then  -- focus is in a side pane: act for the tab's shell
      pane = shell_of(tab:tab_id()) or pane
    end
    local s, h = state(tab, is_tool_pane(pane) and '' or (pane:get_user_vars().GIT_REPO or ''))
    local p = alive(s[kind])
    if not p then  -- opened by the dashboard or an earlier config
      for _, f in ipairs(scan(tab)) do
        if f.kind == kind then
          p = alive(f.id)
          break
        end
      end
    end
    if p then
      s[kind] = nil
      h[kind] = true
      p:send_text('q')
      return
    end
    h[kind] = nil
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

-- Claude Code's executable: npm installs run …/@anthropic-ai/claude-code/bin/claude.exe,
-- the native installer ~/.local/share/claude/versions/<version>, Windows claude.exe.
-- Older npm installs run under node, so Claude's own "✳ …" title counts too.
local function runs_claude(proc, title)
  return (proc or ''):lower():find('claude', 1, true) ~= nil or (title or ''):find('✳', 1, true) ~= nil
end

wezterm.on('format-tab-title', function(tab, tabs, panes, cfg, hover, max_width)
  local pane = tab.active_pane
  local vars = pane.user_vars or {}
  local proc, ptitle = pane.foreground_process_name, pane.title
  if vars.GIT_GRAPH_PANE == '1' then
    -- focus is in a side pane: name the tab after its shell
    local shell = shell_of(tab.tab_id)
    if shell then
      vars, proc, ptitle = shell:get_user_vars(), shell:get_foreground_process_name(), shell:get_title()
    end
  end
  local title
  if tab.tab_title and tab.tab_title ~= '' then
    title = tab.tab_title
  elseif vars.GIT_REPO and vars.GIT_REPO ~= '' then
    title = basename(vars.GIT_REPO)
    if runs_claude(proc, ptitle) then
      title = title .. ' · ' .. ptitle          -- Claude's own status title
    elseif vars.GIT_BRANCH and vars.GIT_BRANCH ~= '' then
      title = title .. ' ⎇ ' .. vars.GIT_BRANCH
    end
  else
    title = ptitle
  end
  -- The fancy tab bar can pass a max_width no wider than this title, so
  -- reserve exactly the prefix and trailing space (reserving 5 cut a letter).
  local prefix = ' ' .. (tab.tab_index + 1) .. ' '
  local room = max_width - #prefix - 1
  if wezterm.column_width(title) > room then
    title = wezterm.truncate_right(title, room - 1) .. '…'
  end
  return prefix .. title .. ' '
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
