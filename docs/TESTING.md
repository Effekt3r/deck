# Manual testing

Unit tests (`npm test`) run in CI on macOS and Windows; this list covers what
they can't: the installed app on a real machine. Take a screenshot of anything
that looks wrong and note the step number.

## Windows 11 smoke test

Install the latest draft or release from GitHub (`Deck-<version>-win-x64.exe`).

**Install**

1. SmartScreen warns because the installer isn't signed yet: **More info → Run
   anyway**. The installer lets you pick a folder; it installs for your user only.
2. Deck has a Start menu entry and a desktop shortcut, both with the Deck icon.
3. In Explorer, right-click a folder → **Show more options → Open in Deck**: Deck
   opens with a tab in that folder (Windows 11 keeps older apps' items in that
   submenu). Try it again with Deck already open: a new tab, not a new window.

**Window and Projects tab**

4. The title bar has Windows' minimise / maximise / close buttons; dragging the
   empty part of the tab strip moves the window; double-clicking it maximises.
5. The Projects tab lists the repos under `C:\Users\<you>\Development` (Settings
   adds other roots, e.g. `D:\code`), newest first, with branch and changes.
   Filter with `/`.
6. Right-click a repo → **Open shell only**: a tab with PowerShell in that folder
   (pwsh if it's installed, otherwise Windows PowerShell).

**Terminal**

7. The tab title becomes `repo ⎇ branch`. `cd ..` and `cd` back: the title follows.
   Try a folder with non-ASCII characters in its name (`mkdir café`, `cd café`):
   the title shows the name correctly.
8. Colours, typing and resizing the window all behave; long output scrolls.
9. Keys: Ctrl+Shift+T new tab, Ctrl+Shift+W close, Ctrl+Tab / Ctrl+Shift+Tab
   switch, Ctrl+Shift+1…9 select, Ctrl+Shift+O Projects, Ctrl+Shift+F find.
10. Copy and paste: select text → Ctrl+Shift+C (or Ctrl+C) copies; Ctrl+Shift+V
    and Ctrl+V paste. Ctrl+C without a selection stops a running command
    (`ping -t localhost`, then Ctrl+C).
11. If your keyboard has AltGr, characters typed with it (e.g. `@`, `\`, `{`)
    arrive normally.

**Git panel**

12. In a repo tab the git panel shows on the left: branch, what it merges into,
    upstream, changes, then the graph. Click a commit: its message and files.
13. Commit something from the terminal (`git commit --allow-empty -m test`): the
    graph shows it within a second or two. (Undo with `git reset --hard HEAD~1`
    only in a scratch repo.)
14. Ctrl+Shift+G hides and shows the panel; drag its edge to resize.

**Claude panel**

15. Double-click a repo in Projects: the tab runs the configured Claude command,
    and the Claude panel appears on the right once Claude starts.
16. Give Claude a small task: the status goes working → running a tool → idle /
    waiting, and the feed shows the prompt, tool calls and reply as they happen.
17. Ctrl+Shift+A hides and shows the panel; the ▾ next to the session title
    lists the folder's sessions and pins one.
18. Links in Claude's replies open in your browser.

**Restart**

19. Quit Deck and open it again: the panel widths are remembered (hiding a panel
    lasts only while that tab stays in that repo).
