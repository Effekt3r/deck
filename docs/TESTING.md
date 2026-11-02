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
18a. Copy two files in Explorer, come back to Deck: a Clipboard card under the Claude panel
     lists them. **Add to Claude** puts both quoted paths into the prompt. (If only the first
     file arrives, report it: Windows' file list needs another route.)
18b. Win+Shift+S a region, come back: the card shows the image; Ctrl+V in the Claude tab
     inserts `[Image #1]`. (If Claude shows the path as text instead, report it: Windows
     paths may need double quotes.)
18c. Copy a password from your password manager: no card, and Ctrl+V pastes it as before.
18d. Drag a PDF from Explorer onto the terminal: its quoted path appears.
18e. Copy a new screenshot, then press Ctrl+V several times quickly in a Claude tab. Each
     paste inserts the image. (Antivirus can hold a just-written file for a moment; Deck
     retries — paste errors only go to the console, so check the prompt, not for a message.)
18f. With Deck in front, copy in Excel or Word several times: each copy's card or paste goes
     through with no copy failures (Deck reads the clipboard about once a second while in
     front; a "clipboard in use" failure would also only be logged to the console).
18g. With Deck in front, press Win+L, then sign in again; and put the PC to sleep and wake it.
     A screenshot taken afterwards still shows a card.
18h. A copy marked only "not for clipboard history" shows no card. In Windows PowerShell:
     `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.DataObject; $d.SetText('s3cret'); $d.SetData('CanIncludeInClipboardHistory', [IO.MemoryStream]::new([byte[]](0,0,0,0))); [System.Windows.Forms.Clipboard]::SetDataObject($d, $true)`
18i. With RDP or Parallels clipboard sharing on, a card doesn't vanish or come back by itself.
18j. Shift+Insert pastes the same way as Ctrl+V (files as paths, an image as [Image #N] with Claude).
18k. Put a large, full-screen screenshot on the clipboard, bring Deck to front, and run something
     that prints continuously (`ping -t localhost`): output doesn't hitch about once a second.
     Note the main process's CPU in Task Manager while it runs.
18l. Previews of copied image files are off on Windows until this passes. Quit Deck, then start
     it from a Command Prompt with `set DECK_FILE_THUMBNAILS=1` followed by Deck's path. Then:
     - copy one photo in Explorer, then three, and come back: the card shows a preview of each
       above the names, the right way up and not black or blank;
     - copy a screenshot saved as a file that has a white background: its white stays white,
       not the card's dark grey;
     - copy three large images (20 MB or more each), come back and press Ctrl+V at once: the
       paths paste, and terminal output doesn't stall;
     - if OneDrive is set up, copy an online-only image: no long freeze (a missing preview is
       fine).
     Report the results: they decide whether previews are turned on for Windows.
18m. Usage card: a Claude tab's pane shows a **Usage** card above the clipboard card. Click
     **Connect**: `%USERPROFILE%\.claude\settings.json` gains a `statusLine` whose command starts
     `powershell -NoProfile`. Give Claude a small task: a second or two after its reply the card
     shows the week ring (and the 5-hour one when Claude reports it) with reset times. They match
     what `/usage` says.
18n. Do 18m with Git for Windows installed (Claude Code then runs status lines through Git Bash)
     and, if you can, on a PC without it (PowerShell). In both, Claude's status line row stays
     empty: no "not recognized" and no PowerShell error in it.
18o. Click **Disconnect**: the `statusLine` leaves settings.json (or goes back to what was there
     before), and the card offers Connect again.

**Restart**

19. Quit Deck and open it again: the panel widths are remembered (hiding a panel
    lasts only while that tab stays in that repo).
