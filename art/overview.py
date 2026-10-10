"""正式美术总览：把 art/out/final/（或简洁版 apps/web/public/art/）拼成几张总览图，夜间底和白天底各一份，自查用。
用法：python art/overview.py [final|simple]   → art/out/overview-<来源>-*.png
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import simple as S  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
which = sys.argv[1] if len(sys.argv) > 1 else "final"
SRC = ROOT / ("art/out/final" if which == "final" else "apps/web/public/art")
OUT = ROOT / "art/out"
NIGHT = (14, 26, 28, 255)
DAY = (244, 240, 228, 255)


def load(rel):
    return Image.open(SRC / rel).convert("RGBA")


def row(imgs, scale, bg, gap=6):
    ims = [i.resize((i.width * scale, i.height * scale), Image.NEAREST) for i in imgs]
    w = sum(i.width for i in ims) + gap * (len(ims) + 1)
    h = max(i.height for i in ims) + gap * 2
    out = Image.new("RGBA", (w, h), bg)
    x = gap
    for i in ims:
        out.alpha_composite(i, (x, gap + (h - 2 * gap - i.height)))
        x += i.width + gap
    return out


def stack(rows, bg):
    w = max(r.width for r in rows)
    out = Image.new("RGBA", (w, sum(r.height for r in rows)), bg)
    y = 0
    for r in rows:
        out.alpha_composite(r, (0, y))
        y += r.height
    return out


cards = [f"cards/treasure-{v}.png" for v in S.TREASURES] + [f"cards/hazard-{k}.png" for k, _ in S.HAZARDS] + \
        [f"cards/artifact-{n}.png" for n in range(1, 6)] + ["cards/back.png", "cards/slot.png"]
for name, bg in (("night", NIGHT), ("day", DAY)):
    rows = [
        row([load(c) for c in cards[:12]], 2, bg),
        row([load(c) for c in cards[12:]], 2, bg),
        row([load(c) for c in cards], 1, bg),
        row([load(f"players/tent-{p[0]}.png") for p in S.PLAYERS] + [load(f"players/tent-{p[0]}-home.png") for p in S.PLAYERS], 2, bg),
        row([load(f"players/explorer-{p[0]}.png") for p in S.PLAYERS] + [load(f"players/mark-{p[0]}.png") for p in S.PLAYERS], 2, bg),
        row([load(f"choice/{k}.png") for k in ("torch", "camp", "card-torch", "card-camp", "card-back")], 2, bg),
        row(sorted((load(str(p.relative_to(SRC))) for p in (SRC / "icons").glob("*.png")), key=lambda i: 0), 2, bg),
        row([load(f"ui/{k}.png") for k in ("banner", "chest", "divider", "badge-5", "badge-10")], 2, bg),
    ]
    stack(rows, bg).save(OUT / f"overview-{which}-{name}.png")
fx = [load(f"fx/{k}.png") for k in ("torch", "gem-spin", "sparkle", "collapse", "crack")]
for name, bg in (("night", NIGHT), ("day", DAY)):
    stack([row([f], 2 if f.width < 400 else 1, bg) for f in fx], bg).save(OUT / f"overview-{which}-fx-{name}.png")
print("ok", sorted(p.name for p in OUT.glob(f"overview-{which}-*.png")))
