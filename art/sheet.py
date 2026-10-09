"""把 public/art 下所有简洁版图拼成一张总览（每张按整数倍放大），输出到 art/out/sheet-*.png，只用来自查。"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "apps/web/public/art"
OUT = ROOT / "art/out"
OUT.mkdir(parents=True, exist_ok=True)

def sheet(paths, scale, name, bg=(40, 44, 48), cols=12):
    ims = [Image.open(p).convert("RGBA") for p in paths]
    ims = [im.resize((im.width * scale, im.height * scale), Image.NEAREST) for im in ims]
    cw = max(i.width for i in ims) + 8
    ch = max(i.height for i in ims) + 8
    cols = min(cols, len(ims))
    rows = (len(ims) + cols - 1) // cols
    s = Image.new("RGBA", (cols * cw, rows * ch), bg + (255,))
    for k, im in enumerate(ims):
        s.alpha_composite(im, ((k % cols) * cw + 4, (k // cols) * ch + 4))
    s.save(OUT / name)
    print(OUT / name, s.size)

for bgname, bg in (("night", (12, 22, 22)), ("day", (244, 240, 228))):
    sheet(sorted((ART / "cards").glob("*.png")), 2, f"sheet-cards-{bgname}.png", bg, 12)
sheet(sorted((ART / "players").glob("*.png")) , 3, "sheet-players.png", (12, 22, 22), 16)
sheet(sorted((ART / "icons").glob("*.png")) + sorted((ART / "choice").glob("*.png")) + sorted((ART / "ui").glob("badge*.png")), 4, "sheet-icons.png", (12, 22, 22), 12)
sheet(sorted((ART / "fx").glob("*.png")) + [ART/"ui/banner.png", ART/"ui/chest.png", ART/"ui/divider.png"], 3, "sheet-fx.png", (12, 22, 22), 1)
