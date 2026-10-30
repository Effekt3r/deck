#!/usr/bin/env python3
"""project_dashboard: quick-access folder list for WezTerm.

Double-click (or Enter) a folder to open it in a new tab and start Claude Code
there with the command from projects.json. Git repos get the branch graph on
the left and the Claude activity pane on the right automatically.

Keys: Enter/double-click open with Claude · o open shell only · p pin/unpin ·
      / filter · Esc clear filter · r rescan · e edit projects.json

Config (created on first run next to this script): projects.json
  command  the command typed into the new tab
  pinned   folders always shown at the top, in this order
  scan     folders whose sub-folders and git repos are listed
  depth    how deep to look for git repos under each scan folder
"""
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from git_graph_pane import (IS_WIN, Keys, bold, clip, cyan, dim, enable_windows_vt_input,  # noqa: E402
                            green, paint, set_user_var, sgr, term_size, yellow)

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "projects.json")
DEFAULT = {
    "command": "claude --effort max --model claude-opus-5-5 --remote-control",
    "pinned": [],
    "scan": ["/Volumes/wyobi", "~/Development"] if not IS_WIN else ["~/Development"],
    "depth": 2,
}
SKIP = {"node_modules", "build", "Pods", "DerivedData", ".gradle", "venv", ".venv", "dist", "target"}


def load_config():
    if not os.path.exists(CONFIG):
        save_config(DEFAULT)
    try:
        with open(CONFIG, encoding="utf-8") as fh:
            cfg = json.load(fh)
    except (OSError, ValueError):
        cfg = {}
    return {**DEFAULT, **cfg}


def save_config(cfg):
    with open(CONFIG, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)
        fh.write("\n")


def norm(p):
    return os.path.normpath(os.path.expanduser(p))


def git_branch(path):
    head = os.path.join(path, ".git", "HEAD")
    if os.path.isfile(os.path.join(path, ".git")):  # worktree / submodule pointer
        try:
            with open(os.path.join(path, ".git"), encoding="utf-8") as fh:
                gd = fh.read().split("gitdir:", 1)[1].strip()
            head = os.path.join(gd if os.path.isabs(gd) else os.path.join(path, gd), "HEAD")
        except (OSError, IndexError):
            return "?"
    try:
        with open(head, encoding="utf-8") as fh:
            ref = fh.read().strip()
    except OSError:
        return None
    return ref[16:] if ref.startswith("ref: refs/heads/") else ref[:7]


def activity_time(path):
    best = 0.0
    for p in (os.path.join(path, ".git", "index"), os.path.join(path, ".git", "HEAD"),
              os.path.join(path, ".git", "FETCH_HEAD"), path):
        try:
            best = max(best, os.path.getmtime(p))
        except OSError:
            pass
    return best


def scan(cfg):
    seen, items = set(), []

    def add(path, pinned=False):
        path = norm(path)
        if path in seen or not os.path.isdir(path):
            return
        seen.add(path)
        items.append({"path": path, "name": os.path.basename(path) or path,
                      "branch": git_branch(path), "pinned": pinned, "t": activity_time(path)})

    for p in cfg.get("pinned", []):
        add(p, True)

    def walk(d, level, max_level):
        try:
            entries = sorted(os.scandir(d), key=lambda e: e.name.lower())
        except OSError:
            return
        for e in entries:
            if not e.is_dir() or e.name.startswith(".") or e.name in SKIP:
                continue
            is_repo = os.path.exists(os.path.join(e.path, ".git"))
            if level == 1 or is_repo:
                add(e.path)
            if not is_repo and level < max_level:
                walk(e.path, level + 1, max_level)

    for root in cfg.get("scan", []):
        walk(norm(root), 1, max(1, int(cfg.get("depth", 2))))
    pinned = [i for i in items if i["pinned"]]
    rest = sorted((i for i in items if not i["pinned"]), key=lambda i: -i["t"])
    return pinned + rest


def ago(t):
    s = time.time() - t
    if s < 3600:
        return f"{int(s // 60)}m"
    if s < 86400:
        return f"{int(s // 3600)}h"
    if s < 86400 * 60:
        return f"{int(s // 86400)}d"
    return f"{int(s // (86400 * 30))}mo"


# ------------------------------------------------------------------ wezterm

def wezterm_bin():
    # Not $WEZTERM_EXECUTABLE: that is wezterm-gui, which has no `cli`
    # subcommand. The CLI binary sits next to it.
    exe_dir = os.environ.get("WEZTERM_EXECUTABLE_DIR")
    for c in (exe_dir and os.path.join(exe_dir, "wezterm.exe" if IS_WIN else "wezterm"),
              shutil.which("wezterm"), "/Applications/WezTerm.app/Contents/MacOS/wezterm"):
        if c and os.path.exists(c):
            return c
    return "wezterm"


def cli(*args):
    try:
        p = subprocess.run([wezterm_bin(), "cli", *args], capture_output=True, text=True, timeout=10)
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def open_folders():
    """Folders that already have a tab (any pane cwd inside them)."""
    out = cli("list", "--format", "json")
    cwds = []
    try:
        for p in json.loads(out or "[]"):
            cwd = p.get("cwd") or ""
            if cwd.startswith("file://"):
                cwd = "/" + cwd[7:].split("/", 1)[-1]
                if IS_WIN and len(cwd) > 2 and cwd[2] == ":":
                    cwd = cwd[1:]
            cwds.append(norm(cwd))
    except ValueError:
        pass
    return cwds


def launch(item, command):
    path = item["path"]
    pane = cli("spawn", "--cwd", path)
    if not pane or not pane.strip().isdigit():
        return f"could not open a tab (is `wezterm` on PATH?)"
    if command:
        cli("send-text", "--pane-id", pane.strip(), "--no-paste", command + "\r")
    # Git repos get their side panes from wezterm.lua; plain folders get the
    # Claude activity pane from here.
    if command and not item["branch"]:
        cli("split-pane", "--pane-id", pane.strip(), "--right", "--percent", "30", "--cwd", path,
            "--", sys.executable, os.path.join(HERE, "claude_activity_pane.py"), path)
        cli("activate-pane", "--pane-id", pane.strip())
    return f"opened {item['name']}"


# ---------------------------------------------------------------------- main

HEADER_ROWS = 4


def render(items, sel, top, width, height, filt, filtering, msg, cfg, open_set):
    out = [bold("⌂ Projects") + "  " + dim("double-click / Enter: Claude · o: shell · p: pin · /: filter · e: edit"),
           dim("  runs: ") + cyan(cfg["command"]),
           (yellow("/" + filt + ("▏" if filtering else "")) if (filt or filtering) else dim(msg or " ")),
           dim("─" * width)]
    rows = height - HEADER_ROWS
    name_w = max([len(i["name"]) for i in items] + [10])
    name_w = min(name_w, max(12, width // 3))
    for idx in range(top, min(len(items), top + rows)):
        it = items[idx]
        star = yellow("★") if it["pinned"] else " "
        live = green("●") if it["path"] in open_set else " "
        br = it["branch"]
        br_txt = (cyan("⎇ " + br) if br else dim("folder"))
        name = it["name"][:name_w].ljust(name_w)
        line = f"{star}{live} {bold(name) if br else name}  {dim(ago(it['t']).rjust(3))}  {br_txt}  " \
               f"{dim(it['path'].replace(os.path.expanduser('~'), '~', 1))}"
        line = clip(line, width)
        if idx == sel:
            line = sgr("7", clip(line.replace("\x1b[0m", "\x1b[0m\x1b[7m"), width)) + "\x1b[7m" + \
                " " * 0
        out.append(line)
    if not items:
        out.append(dim("  nothing found — add folders to \"scan\" or \"pinned\" in projects.json (press e)"))
    return out


def main():
    if "--once" in sys.argv:
        cfg = load_config()
        items = scan(cfg)
        print("\n".join(render(items, 0, 0, 100, 30, "", False, "", cfg, set())))
        return 0
    if IS_WIN:
        os.system("")
        enable_windows_vt_input()
    set_user_var("GIT_GRAPH_PANE", "1")
    set_user_var("DASHBOARD", "1")
    sys.stdout.write("\x1b]2;⌂ Projects\x07\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?1000h\x1b[?1006h")
    sys.stdout.flush()

    cfg = load_config()
    all_items = scan(cfg)
    open_set, last_open = set(), 0.0
    sel = top = 0
    filt, filtering, msg = "", False, ""
    last_click = (0.0, -1)
    last_scan = time.time()
    try:
        with Keys() as keys:
            while True:
                w, h = term_size()
                rows = max(1, h - HEADER_ROWS)
                items = [i for i in all_items if filt.lower() in (i["name"] + " " + i["path"]).lower()]
                act = None
                for k in keys.read(0.3):
                    if filtering:
                        if k in ("\r", "\n", "esc"):
                            filtering = False
                            if k == "esc":
                                filt = ""
                        elif k in ("\x7f", "\b"):
                            filt = filt[:-1]
                        elif isinstance(k, str) and len(k) == 1 and k.isprintable():
                            filt += k
                        sel = 0
                        continue
                    if isinstance(k, tuple):  # click
                        _, x, y = k
                        idx = top + (y - 1 - HEADER_ROWS)
                        if 0 <= idx < len(items) and y > HEADER_ROWS:
                            now = time.time()
                            if last_click[1] == idx and now - last_click[0] < 0.45:
                                act = ("claude", idx)
                                last_click = (0.0, -1)
                            else:
                                last_click = (now, idx)
                            sel = idx
                    elif k in ("j", "down"):
                        sel += 1
                    elif k in ("k", "up"):
                        sel -= 1
                    elif k == "wheeldown":
                        top += 3
                    elif k == "wheelup":
                        top -= 3
                    elif k == "pgdn":
                        sel += rows
                    elif k == "pgup":
                        sel -= rows
                    elif k in ("\r", "\n"):
                        act = ("claude", sel)
                    elif k == "o":
                        act = ("shell", sel)
                    elif k == "/":
                        filtering, filt = True, ""
                    elif k == "esc":
                        filt = ""
                    elif k == "r":
                        cfg = load_config(); all_items = scan(cfg); msg = "rescanned"
                    elif k == "p" and items:
                        path = items[max(0, min(sel, len(items) - 1))]["path"]
                        pinned = [norm(p) for p in cfg.get("pinned", [])]
                        if path in pinned:
                            pinned.remove(path); msg = "unpinned"
                        else:
                            pinned.append(path); msg = "pinned"
                        cfg["pinned"] = pinned
                        save_config(cfg)
                        all_items = scan(cfg)
                    elif k == "e":
                        pane = cli("spawn", "--cwd", HERE)
                        if pane:
                            editor = os.environ.get("EDITOR") or ("notepad" if IS_WIN else "nano")
                            cli("send-text", "--pane-id", pane, "--no-paste", f'{editor} "{CONFIG}"\r')
                items = [i for i in all_items if filt.lower() in (i["name"] + " " + i["path"]).lower()]
                sel = max(0, min(sel, len(items) - 1))
                if sel < top:
                    top = sel
                if sel >= top + rows:
                    top = sel - rows + 1
                top = max(0, min(top, max(0, len(items) - rows)))
                if act and items:
                    kind, idx = act
                    it = items[max(0, min(idx, len(items) - 1))]
                    msg = launch(it, cfg["command"] if kind == "claude" else "")
                    it["t"] = time.time()
                now = time.time()
                if now - last_open > 3:
                    last_open = now
                    open_set = set()
                    for c in open_folders():
                        for it in all_items:
                            if c == it["path"] or c.startswith(it["path"] + os.sep):
                                open_set.add(it["path"])
                if now - last_scan > 60:
                    last_scan, all_items = now, scan(cfg)
                lines = render(items, sel, top, w, h, filt, filtering, msg, cfg, open_set)
                paint([l + "\x1b[0m" for l in lines], h)
    except KeyboardInterrupt:
        return 0
    finally:
        sys.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?7h\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()


if __name__ == "__main__":
    sys.exit(main() or 0)
