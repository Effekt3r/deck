# Deck branding

`generate.py` builds every icon and installer image from the SVG code in it.
Edit colours or shapes there, then run:

    pip install playwright pillow && python -m playwright install chromium   # once
    python3 branding/generate.py

Palette: navy `#20264A → #0B0D1F`, teal `#3DDCC1` (git), amber `#FF9F43`
(prompt / feature branch), violet `#A78BFA` (activity), ink `#F4F5FB`.
Mark: a git branch (teal line, two commits) beside a prompt chevron (amber).
Same mark at every size, 16 px to 1024 px.

`out/preview.png` is a contact sheet of everything; `out/*.svg` are the masters
(Mac tile with shadow, Windows full tile, mono glyph).

Do not use Anthropic's Claude marks or the name "Claude" in Deck's branding.
