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
     inserts `[Image #1]`, and so does **Add to Claude**. (Deck pastes the image's path with its
     backslashes doubled, as Claude Code expects; if Claude shows the path as text instead,
     report it.)
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
     and, if you can, on a PC without it (PowerShell). Claude Code never shows a status line run
     that failed, so check the files instead: after a reply, `%APPDATA%\Deck\usage\statusline.json`
     has just been written (its Date modified is a second or two after the reply), and no
     `.statusline.*.tmp` files pile up beside it. Also do 18m from a Deck tab whose shell is
     pwsh 7 (Deck uses pwsh when it's installed): a Windows PowerShell started from there
     inherits pwsh 7's module path.
18o. Click **Disconnect**: the `statusLine` leaves settings.json (or goes back to what was there
     before), and the card offers Connect again. Connect once more: the card waits for Claude's
     next reply instead of showing the old numbers.

**Device panel**

18p. Install Android Studio (or Android's platform tools), plug in an Android phone with USB
     debugging on, and allow this PC when the phone asks. In a terminal, note what
     `adb shell settings get global stay_on_while_plugged_in` prints, for 18w (Android Studio puts
     adb in `%LOCALAPPDATA%\Android\Sdk\platform-tools`). Open a tab in an Android app's folder: a
     git repository or a Gradle build, with `app\src\main\AndroidManifest.xml` (or the same inside
     `android\`). Within a few seconds the phone's screen shows at the top of the right pane, and
     the header reads `Android <version> · USB`.
18q. Click to tap, drag to swipe, hold to long-press; the wheel scrolls a list about a step per
     notch. Back, Home, Recent apps and Power in the panel's header work. Rotate the phone while
     holding a drag on its screen in Deck: the picture turns, and nothing stays pressed on the phone.
18r. Click the screen, then type into a text field on the phone; Shift+arrows select text, and Home
     and End go to the line's ends. With a German keyboard layout (add one in Settings, switch with
     Win+Space): AltGr+Q and Ctrl+Alt+Q both type `@` on the phone, ´ (left of Backspace) then E
     types `é`, and Alt+F does nothing there. Ctrl+Backspace deletes a word on the phone and Ctrl+←
     moves back a word; Alt+Backspace does nothing there. Tab and Esc go to the phone too; clicking
     the terminal gives it the keyboard back, and clicking beside the phone's screen, in the panel's
     empty space, leaves the keyboard where it was.
18s. Ctrl+V and Ctrl+Shift+V paste copied text into a field on the phone. Select a word in Claude's
     reply, Ctrl+C, click the screen, Ctrl+V: the word goes to the phone, not the terminal. Ctrl+A
     with the screen selected, then Ctrl+V: the paste still goes to the phone. With Claude running in
     the tab, the camera in the panel's header adds `[Image #N]` to Claude's prompt, and so does one
     `.png` copied in Explorer and pasted with Ctrl+V in that tab.
18t. Ctrl+Shift+D hides the panel and shows it again. With an emulator running too, the ▾ next to the
     name switches between the two, and a new tab in the same folder shows the one picked last.
     Close the emulator: that tab shows the phone again, since it was picked there too.
18u. Pull the phone's cable: "disconnected" over the dimmed picture, and the panel goes 10 s later
     (the emulator closed).
     Plug it back in: the panel comes back.
18v. Minimise Deck for 15 s, then restore it: the screen streams again within a couple of seconds.
     Task Manager's Details tab then lists three adb.exe: adb's own server, Deck's device list and
     the stream, with none left over from the stream before.
18w. Fold the device panel (its caret) and wait 15 s; unfold it and close Deck within a second, while
     it says "Connecting…". Then `adb shell pgrep -f com.genymobile.scrcpy.Server` prints nothing,
     `adb shell settings get global stay_on_while_plugged_in` prints what it did in 18p, and Task
     Manager shows no adb.exe beyond adb's own server.
18x. In a Command Prompt (PowerShell rewrites a program's output), with the phone plugged in:
     `adb track-devices -l > track.txt`, wait 5 s, then Ctrl+C. Attach `track.txt` to your report:
     Deck reads adb's lists expecting Windows may turn their line ends into "\r\n", which hasn't been
     seen yet.
18y. Quit Deck, rename Android's `platform-tools` folder, and open Deck in the Android app's folder:
     the panel isn't there (nothing to show without adb; View → Device Panel says Deck can't find adb).
     Rename the folder back, click another window, then Deck: the phone's screen appears without a
     restart.
18z. Claude panel images: open Deck in a folder whose Claude session has images (one where you pasted a
     screenshot into a prompt, or Claude read an image file). Thumbnails show under the prompt and under
     the Read call. Click one: the viewer covers the window below the tab bar; ← and → step, Esc
     closes, and typing goes to the terminal again. Double-click a thumbnail: the viewer stays open.
     With the viewer open, press Ctrl+Shift+F: the viewer closes and the terminal's search has the
     keyboard; Esc closes the search, and typing goes to the terminal again.
18aa. In the viewer, click **Open**: Photos shows the image. Close Photos and quit Deck: the copy in
     `%TEMP%\Deck clipboard\<8 characters>\image-….png` is gone. Again, leaving Photos open while
     quitting: the copy stays until Deck's next start removes it.
18ab. The picture button in the Claude panel's header turns every tab's thumbnails into "▣ N images";
     click it again to show them.
18ac. Tabs: run `claude` in two tabs. In one, type `/config`: that tab gets an amber dot and an amber
     top edge, and keeps them when you switch to the other tab. Go back to it and press Esc: the mark
     goes.
     (No mark ever: Claude Code may not write `%USERPROFILE%\.claude\sessions` on Windows. Report it.)
18ad. In the first tab, ask Claude to run `sleep 15; touch deck-check.txt` (in the default permission
     mode it asks before a command that changes something) and switch to another app at once: when
     the question appears, Deck's taskbar button flashes until you come back, and the tab shows the
     amber mark. Allow it, and switch to the other tab within the 15 s: when Claude finishes, the
     first tab gets a green ✓ and a green top edge; clicking it clears them. Delete `deck-check.txt`.
18ae. Drag a terminal tab across the others and drop it; press Esc mid-drag to put one back. The
     Projects tab stays first.
18af. Ctrl+Shift+PageUp and Ctrl+Shift+PageDown move the front tab left and right.
18ag. Scroll the front tab's Claude panel up, then drag that tab to the right: the panel stays
     where you scrolled it.
18ah. Starting an emulator, only with an AVD you're happy to start (Android Studio › Device Manager):
     with no phone plugged in and the emulator closed, open an Android app's tab and press
     Ctrl+Shift+D. The panel says "No devices connected" with **Start <AVD>** (its `_` as spaces), and
     the ▾ menu lists it under Start. Click it: "Starting <AVD>…" with a spinner, the emulator's own
     window opens, and the panel shows its screen once Android has started, without "Couldn't show".
     Note it if a console window opens beside the emulator, or the emulator's window doesn't show. If
     it fails instead, its reason should be in
     `%TEMP%\Deck emulators\<8 characters>\<AVD>-<digits>.log` (the AVD's own name, `_` not spaces;
     the newest file, one per start).
18ai. ▾ → **Stop <AVD>**: the emulator closes; "disconnected", then the panel stays with its Start
     button first. View → Device Panel on a new tab in the same folder offers that Start button too
     (a fresh tab no longer opens the panel by itself for a stopped device). Start it again from
     there, then quit Deck: the emulator keeps running.

**Restart**

19. Quit Deck and open it again: the panel widths and the device panel's height are
    remembered (hiding a panel lasts only while that tab stays in that repo).

## macOS: an iPhone on a cable

macOS only (Windows shows no iPhones), numbered after the Windows steps. Install the latest draft or
release (`Deck-<version>-mac-arm64.dmg`). You need an iPhone that trusts this Mac, unlocked, on a
cable, and a folder with an Xcode project in a git repository.

20. Open Deck in the iOS project's folder: after about 3 s ("Looking for devices…") the device panel
    shows the iPhone by its name, or asks between it and a booted simulator. Its ▾ menu says
    `iPhone · cable · view only`, and doesn't offer the phone's own camera ("… iPhone Camera").
21. The first time, macOS asks whether **Deck** may use the camera: "Deck shows a connected iPhone's
    screen, which macOS treats as a camera." Meanwhile the panel says "Connecting to …". Allow: the
    screen shows within a few seconds, sharp and in proportion. (If macOS names another app, or
    refuses without asking, report it.)
22. The header has no Back, Home or Power. With Claude running in the tab, the camera adds a
    screenshot to Claude's prompt as `[Image #N]`. Clicking the screen does nothing, and neither does
    clicking beside it: typing still goes to the terminal.
23. Turn the phone to landscape in an app that turns (Photos): the picture turns with it. (If it
    turns inside a portrait frame instead, report it.)
24. Leave the phone untouched for 15 s, switch to another tab, and come back within 10 s: the
    picture is back at once, not blank. Again with a video playing on the phone.
25. Lock the phone, wait 30 s, then unlock it: note what the panel shows meanwhile (the last picture,
    black, "Reconnecting…", or "Couldn't show …" with its reason), and whether the picture comes back
    by itself or only after **Try again**.
26. Unplug it: "disconnected" over the dimmed picture (not "Reconnecting…" or "Couldn't show …"), and
    the panel goes 10 s later. Plug it in again: it's back within a few seconds. Note it if either
    takes about 5 s or more.
27. Lock the Mac (Ctrl+Cmd+Q) and unlock it straight away: the picture comes back within a few
    seconds. Then quit Deck and open it again at once: the same.
28. Play a video with sound on the phone while Deck shows it: the sound stays on the phone.
29. While Deck shows the phone, run an app on it from Xcode: Xcode installs and starts it as usual,
    and Deck's picture carries on.
30. Open QuickTime Player › File › New Movie Recording, and pick the iPhone from the menu beside the
    record button: note what Deck's panel shows while QuickTime shows the phone, and once QuickTime's
    window is closed (with **Try again** if the panel offers it).
31. In System Settings › Privacy & Security › Camera, turn Deck off. In Deck, switch to another tab
    for 15 s, then back: "Camera not allowed" at once (no "Reconnecting…" before it), with **Open
    System Settings** and **Try again**; clicking either leaves typing in the terminal. **Open System
    Settings** opens that same page (if not, note where it lands). Turn Deck on there (if macOS
    offers to quit and reopen Deck, choose Later), then come back to Deck: the screen shows, by itself
    if System Settings had covered Deck's window, else after **Try again**.
32. With the panel showing the phone and something moving on it, Activity Monitor (search
    "iphone-screen") lists two `iphone-screen` processes, the list and the stream: note their CPU and
    Deck's. Fold the panel: 10 s later only the list is left, using next to no CPU. Quit Deck: none
    is left.

## macOS: starting and stopping simulators and emulators

On the installed app (your own simulators are fine here: this is your check). Quit Simulator.app
first.

33. In an iOS project's tab with no simulator booted, press Cmd+Shift+D: "No devices connected" with up
    to 3 **Start <simulator>** buttons, then "More in the ▾ menu"; the ▾ menu lists every shut-down
    simulator under Start, an iOS app's first. Click one: "Starting <name>…" with a spinner until it
    has booted (about 20 s the first time), then its screen. Simulator.app doesn't open; opened, it
    shows the simulator.
34. ▾ → **Stop <name>**: it shuts down; "disconnected", then the panel stays with its Start button
    first. View → Device Panel on a new tab in the same project offers that button too, without
    Cmd+Shift+D opening it by itself (a fresh tab no longer does that for a stopped device). Start it
    from the ▾ menu's Start section this time: the same as 33, quicker.
35. Start a simulator and quit Deck while it says "Starting …": the simulator finishes booting anyway
    (`xcrun simctl list devices booted`).
36. With an AVD (only one you're happy to start): 18ah and 18ai on the Mac, and note any macOS prompt
    that names Deck (the microphone or the camera, asked for by the emulator). Without any AVD, an
    Android app's empty panel (Cmd+Shift+D) says "No emulators: make one in Android Studio's Device
    Manager".
