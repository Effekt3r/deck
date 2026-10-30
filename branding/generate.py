#!/usr/bin/env python3
"""Generate Deck's icons and installer artwork.

Sources are the SVG builders below (edit colours/shapes here, then re-run).
Needs: Python Playwright with Chromium, Pillow.

    python3 branding/generate.py            # writes into build/ and branding/out/

Outputs
  build/icon.icns            macOS app icon (16…1024, @1x/@2x)
  build/icon.ico             Windows app + installer icon (16…256)
  build/icon.png             1024 master (electron-builder fallback)
  build/icons/NxN.png        Linux / misc sizes
  build/background.png       DMG window background (660×400) + @2x
  build/installerSidebar.bmp NSIS welcome/finish sidebar (164×314)
  build/uninstallerSidebar.bmp
  build/installerHeader.bmp  NSIS page header (150×57)
  build/trayTemplate.png     macOS menu-bar template icon + @2x
  build/tray.png / tray.ico  Windows tray icon
  branding/out/*.svg         master SVGs (mac tile, windows tile, glyph)
  branding/out/preview.png   contact sheet of everything
"""
import io
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
OUT = os.path.join(ROOT, "branding", "out")

# ---------------------------------------------------------------- palette
NAVY_TOP = "#20264A"
NAVY_BOTTOM = "#0B0D1F"
TEAL = "#3DDCC1"       # git / main line
AMBER = "#FF9F43"      # prompt + feature branch
VIOLET = "#A78BFA"     # accent (installer stripe)
INK = "#F4F5FB"

FONT = "'Inter Display','Inter',system-ui,sans-serif"


def tile_art(detail=True):
    """Artwork in an 824×824 tile coordinate space (no background).

    One mark at every size: a git branch (teal) next to a prompt chevron (amber).
    `detail` is kept for API compatibility; the mark is the same at all sizes.
    """
    return f"""
      <path d="M248 250 V574" stroke="{TEAL}" stroke-width="56" stroke-linecap="round"/>
      <circle cx="248" cy="262" r="58" fill="{TEAL}"/>
      <circle cx="248" cy="562" r="58" fill="{TEAL}"/>
      <polyline points="432,262 592,412 432,562" stroke="{AMBER}" stroke-width="84"
                stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    """


def defs():
    return f"""
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="{NAVY_TOP}"/>
        <stop offset="1" stop-color="{NAVY_BOTTOM}"/>
      </linearGradient>
      <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/>
        <stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.35"/>
      </filter>
    </defs>"""


def tile(size_px, inset, radius, detail=True, shadow=False):
    """A 1024 canvas with the tile at `inset` (canvas units) and corner `radius`."""
    side = 1024 - 2 * inset
    scale = side / 824
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size_px}" height="{size_px}" viewBox="0 0 1024 1024">
    {defs()}
    <g {'filter="url(#shadow)"' if shadow else ''}>
      <rect x="{inset}" y="{inset}" width="{side}" height="{side}" rx="{radius}" fill="url(#bg)"/>
    </g>
    <rect x="{inset}" y="{inset}" width="{side}" height="{side}" rx="{radius}" fill="url(#sheen)"/>
    <rect x="{inset + 1.5}" y="{inset + 1.5}" width="{side - 3}" height="{side - 3}" rx="{radius - 1.5}"
          fill="none" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="3"/>
    <g transform="translate({inset} {inset}) scale({scale})">{tile_art(detail)}</g>
    </svg>"""


def mac_icon(px, detail=True):
    # Apple grid: 824 tile on 1024 canvas, ~185 corner radius, soft shadow
    return tile(px, 100, 185, detail, shadow=True)


def win_icon(px, detail=True):
    # Windows: near full-bleed rounded square
    return tile(px, 40, 190, detail, shadow=False)


def glyph(px, color="#000000"):
    """Monochrome glyph for the macOS menu bar / tray (same mark as the icon)."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 32 32">
      <path d="M9 8 V24" stroke="{color}" stroke-width="2.8" stroke-linecap="round" fill="none"/>
      <circle cx="9" cy="8.5" r="3.2" fill="{color}"/><circle cx="9" cy="23.5" r="3.2" fill="{color}"/>
      <polyline points="17,9 24,16 17,23" stroke="{color}" stroke-width="3.6" stroke-linecap="round"
                stroke-linejoin="round" fill="none"/>
    </svg>"""


def page(html_body, w, h, bg="transparent"):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{{margin:0;padding:0;width:{w}px;height:{h}px;overflow:hidden;background:{bg};}}
      *{{box-sizing:border-box}}</style></head><body>{html_body}</body></html>"""


def dmg_background(scale):
    w, h = 660, 400
    s = mac_icon(1, True).replace('width="1" height="1"', 'width="0" height="0"')  # unused
    return page(f"""
      <div style="position:absolute;inset:0;background:
           radial-gradient(900px 500px at 50% -10%, #2A3166 0%, rgba(0,0,0,0) 60%),
           linear-gradient(180deg,{NAVY_TOP} 0%,{NAVY_BOTTOM} 100%);transform-origin:0 0;"></div>
      <div style="position:absolute;inset:0;transform:scale({scale});transform-origin:0 0;width:{w}px;height:{h}px;
                  font-family:{FONT};color:{INK}">
        <div style="position:absolute;left:0;right:0;top:38px;text-align:center;font-size:30px;font-weight:700;letter-spacing:-0.5px">Deck</div>
        <div style="position:absolute;left:0;right:0;top:78px;text-align:center;font-size:13px;opacity:.6">by Effekt Studios</div>
        <!-- arrow between the app (x=180) and Applications (x=480) icon slots at y=215 -->
        <svg style="position:absolute;left:260px;top:190px" width="140" height="50" viewBox="0 0 140 50">
          <path d="M8 25 H118" stroke="{AMBER}" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12"/>
          <polyline points="104,11 124,25 104,39" fill="none" stroke="{AMBER}" stroke-width="5"
                    stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div style="position:absolute;left:0;right:0;bottom:46px;text-align:center;font-size:13px;opacity:.75">
          Drag Deck to Applications to install</div>
      </div>""", int(w * scale), int(h * scale))


def nsis_sidebar(title_line):
    w, h = 164, 314
    art = win_icon(96)
    return page(f"""
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,{NAVY_TOP},{NAVY_BOTTOM});
                  font-family:{FONT};color:{INK}">
        <div style="position:absolute;left:34px;top:40px;width:96px;height:96px">{art}</div>
        <div style="position:absolute;left:0;right:0;top:154px;text-align:center;font-size:26px;font-weight:700">Deck</div>
        <div style="position:absolute;left:0;right:0;top:188px;text-align:center;font-size:10.5px;opacity:.65">{title_line}</div>
        <div style="position:absolute;left:18px;right:18px;bottom:22px;height:3px;border-radius:2px;
                    background:linear-gradient(90deg,{TEAL},{AMBER},{VIOLET})"></div>
        <div style="position:absolute;left:0;right:0;bottom:34px;text-align:center;font-size:9.5px;opacity:.55">by Effekt Studios</div>
      </div>""", w, h)


def nsis_header():
    w, h = 150, 57
    art = win_icon(40)
    return page(f"""
      <div style="position:absolute;inset:0;background:#FFFFFF;font-family:{FONT};color:#14172E">
        <div style="position:absolute;right:10px;top:8px;width:40px;height:40px">{art}</div>
        <div style="position:absolute;right:58px;top:13px;font-size:17px;font-weight:700;text-align:right">Deck</div>
        <div style="position:absolute;right:58px;top:33px;font-size:8.5px;opacity:.55;text-align:right">Effekt Studios</div>
      </div>""", w, h)


# ---------------------------------------------------------------- render

# Same slots `iconutil` writes: 16/32/64 @1x, 128–512 @1x, and every @2x.
ICNS_SLOTS = [(b"icp4", 16), (b"icp5", 32), (b"icp6", 64), (b"ic07", 128), (b"ic08", 256),
              (b"ic09", 512), (b"ic10", 1024), (b"ic11", 32), (b"ic12", 64), (b"ic13", 256),
              (b"ic14", 512)]


def write_icns(path, images):
    """Write an .icns with PNG payloads for every standard slot."""
    import struct
    chunks = b""
    for code, px in ICNS_SLOTS:
        buf = io.BytesIO()
        images[px].save(buf, "PNG")
        data = buf.getvalue()
        chunks += code + struct.pack(">I", len(data) + 8) + data
    with open(path, "wb") as fh:
        fh.write(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


def main():
    from playwright.sync_api import sync_playwright

    os.makedirs(os.path.join(BUILD, "icons"), exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    masters = {
        "icon-mac.svg": mac_icon(1024), "icon-windows.svg": win_icon(1024),
        "glyph.svg": glyph(32),
    }
    for name, svg in masters.items():
        with open(os.path.join(OUT, name), "w") as fh:
            fh.write(svg)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        def shot(html, w, h, scale=1):
            pg = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
            pg.set_content(html)
            pg.wait_for_timeout(150)
            png = pg.screenshot(omit_background=True, clip={"x": 0, "y": 0, "width": w, "height": h})
            pg.close()
            return Image.open(io.BytesIO(png)).convert("RGBA")

        def svg_png(svg, px):
            # Render at the target size with the given SVG (browser handles AA)
            svg = svg.replace('width="1024" height="1024"', f'width="{px}" height="{px}"', 1)
            return shot(page(svg, px, px), px, px)

        def icon(kind, px):
            small = px <= 32
            src = mac_icon(1024, not small) if kind == "mac" else win_icon(1024, not small)
            return svg_png(src, px)

        # --- macOS .icns
        mac_sizes = [16, 32, 64, 128, 256, 512, 1024]
        mac = {s: icon("mac", s) for s in mac_sizes}
        write_icns(os.path.join(BUILD, "icon.icns"), mac)
        mac[1024].save(os.path.join(BUILD, "icon.png"))

        # --- Windows .ico
        win_sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
        win = {s: icon("win", s) for s in win_sizes}
        win[256].save(os.path.join(BUILD, "icon.ico"), sizes=[(s, s) for s in win_sizes],
                      append_images=[win[s] for s in win_sizes if s != 256])

        # --- Linux / misc PNGs (Windows-style full tile reads best in launchers)
        for s in [16, 24, 32, 48, 64, 128, 256, 512, 1024]:
            img = win[s] if s in win else icon("win", s)
            img.save(os.path.join(BUILD, "icons", f"{s}x{s}.png"))

        # --- tray
        for s, suffix in ((16, ""), (32, "@2x")):
            svg_png(glyph(s, "#000000"), s).save(os.path.join(BUILD, f"trayTemplate{suffix}.png"))
        tray = {s: svg_png(glyph(s, "#FFFFFF"), s) for s in (16, 24, 32)}
        tray[32].save(os.path.join(BUILD, "tray.png"))
        tray[32].save(os.path.join(BUILD, "tray.ico"), sizes=[(16, 16), (24, 24), (32, 32)],
                      append_images=[tray[16], tray[24]])

        # --- DMG background
        shot(dmg_background(1), 660, 400).convert("RGB").save(os.path.join(BUILD, "background.png"))
        shot(dmg_background(2), 1320, 800).convert("RGB").save(os.path.join(BUILD, "background@2x.png"))

        # --- NSIS bitmaps (24-bit BMP)
        shot(nsis_sidebar("Terminal for Claude Code"), 164, 314).convert("RGB").save(
            os.path.join(BUILD, "installerSidebar.bmp"))
        shot(nsis_sidebar("Uninstall"), 164, 314).convert("RGB").save(
            os.path.join(BUILD, "uninstallerSidebar.bmp"))
        shot(nsis_header(), 150, 57).convert("RGB").save(os.path.join(BUILD, "installerHeader.bmp"))

        browser.close()

    preview()
    print("assets written to", BUILD)


def preview():
    """Contact sheet: icons at real sizes on light + dark, plus installer art."""
    W, H = 1500, 770
    sheet = Image.new("RGB", (W, H), "#EDEEF3")
    dark = Image.new("RGB", (W // 2, 330), "#1C1C1E")
    sheet.paste(dark, (W // 2, 0))
    mac = Image.open(os.path.join(BUILD, "icon.png")).convert("RGBA")
    x = 30
    for s in (512, 128, 64, 32, 16):
        pass
    big = mac.resize((300, 300), Image.LANCZOS)
    sheet.paste(big, (20, 15), big)
    sheet.paste(big, (W // 2 + 20, 15), big)
    x0 = 340
    for s in (128, 64, 32, 16):
        img = Image.open(os.path.join(BUILD, "icons", f"{s}x{s}.png")).convert("RGBA")
        sheet.paste(img, (x0, 160 - s // 2), img)
        sheet.paste(img, (W // 2 + x0, 160 - s // 2), img)
        x0 += s + 30
    ico = Image.open(os.path.join(BUILD, "icons", "256x256.png")).convert("RGBA")
    sheet.paste(ico, (20, 350), ico)
    tray = Image.open(os.path.join(BUILD, "trayTemplate@2x.png")).convert("RGBA")
    sheet.paste(tray, (300, 350), tray)
    bg = Image.open(os.path.join(BUILD, "background.png"))
    sheet.paste(bg, (360, 350))
    m = mac.resize((128, 128), Image.LANCZOS)
    sheet.paste(m, (360 + 180 - 64, 350 + 215 - 64), m)  # where electron-builder puts the app icon
    side = Image.open(os.path.join(BUILD, "installerSidebar.bmp"))
    sheet.paste(side, (1050, 350))
    sheet.paste(Image.open(os.path.join(BUILD, "uninstallerSidebar.bmp")), (1230, 350))
    sheet.paste(Image.open(os.path.join(BUILD, "installerHeader.bmp")), (1050, 690))
    sheet.save(os.path.join(OUT, "preview.png"))


if __name__ == "__main__":
    sys.exit(main())
