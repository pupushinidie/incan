"""按 art/spec.md 第 3 节的倍数，把简洁版摆成 8 人局牌桌草图（1440×790 / 390×664，夜间 / 白天），只用来自查，输出到 art/out/mock/。
文字用 Fusion Pixel 12px 的 2 倍（= 24px）画，模拟界面上的 CSS 文字。不是界面，只是量尺寸、看清不清楚。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import sys
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "art"))
import simple as S  # noqa
A = ROOT / ("art/out/final" if "--final" in sys.argv else "apps/web/public/art")
OUT = ROOT / ("art/out/mock-final" if "--final" in sys.argv else "art/out/mock")
OUT.mkdir(parents=True, exist_ok=True)

def L(rel, k=1):
    im = Image.open(A / rel).convert("RGBA")
    return im.resize((im.width * k, im.height * k), Image.NEAREST)

def frame0(rel, fw, k=1):
    im = Image.open(A / rel).convert("RGBA").crop((0, 0, fw, Image.open(A / rel).height))
    return im.resize((im.width * k, im.height * k), Image.NEAREST)

def txt(img, s, x, y, col, scale=2, anchor="l"):
    t = S.text_img(s, S.rgb(col), scale, None)
    if anchor == "c":
        x -= t.width // 2
    img.alpha_composite(t, (x, y))
    return t.width

PATH = ["treasure-11", "hazard-fire", "treasure-5", "artifact-1", "treasure-7", "hazard-snake", "treasure-2",
        "treasure-14", "hazard-mummy", "treasure-4", "artifact-2", "treasure-9", "treasure-1", "hazard-fire"]

def cover(img, day):
    bg = L(f"scene/{'day' if day else 'night'}.png", 3)
    W, H = img.size
    img.alpha_composite(bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H)))
    veil = Image.new("RGBA", (W, H), (244, 240, 228, 150) if day else (6, 12, 14, 150))
    img.alpha_composite(veil)

def panel(img, box, day):
    d = ImageDraw.Draw(img)
    d.rectangle(box, fill=(250, 246, 236, 225) if day else (10, 20, 22, 215), outline=(60, 50, 40) if day else (70, 84, 74))

def desktop(day):
    W, H = 1440, 790
    fg = "#2a2018" if day else "#f6e8b8"
    img = Image.new("RGBA", (W, H))
    cover(img, day)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 44], fill=(232, 222, 200) if day else (8, 14, 16))
    txt(img, "印加宝藏 · 第 3 局 / 5", 16, 8, fg)
    for i in range(5):
        img.alpha_composite(L("icons/temple.png", 2), (360 + i * 36, 6))
    panel(img, (W - 300, 44, W, H), day)
    txt(img, "记录", W - 284, 56, fg)
    # 牌桌区
    x0, y0 = 12, 56
    bw = W - 300 - 24
    # 危险条 + 牌堆 + 路径余数
    panel(img, (x0, y0, x0 + bw, y0 + 52), day)
    x = x0 + 12
    for k, _ in S.HAZARDS:
        img.alpha_composite(L(f"icons/hazard-{k}.png", 2), (x, y0 + 10))
        x += 36
        x += txt(img, "×1" if k in ("fire", "snake", "mummy") else "×0", x, y0 + 12, fg) + 18
    img.alpha_composite(L("icons/deck.png", 2), (x + 20, y0 + 10)); x += 56
    x += txt(img, "剩 17", x, y0 + 12, fg) + 30
    img.alpha_composite(L("icons/gem.png", 2), (x, y0 + 10)); x += 36
    x += txt(img, "路上 3", x, y0 + 12, fg) + 30
    img.alpha_composite(L("icons/artifact.png", 2), (x, y0 + 10)); x += 36
    txt(img, "路上神器 1", x, y0 + 12, fg)
    # 路径：2× 卡 80×112，一行 12 张
    py = y0 + 64
    for i, c in enumerate(PATH):
        r, col = divmod(i, 12)
        img.alpha_composite(L(f"cards/{c}.png", 2), (x0 + 12 + col * 88, py + r * 120))
    img.alpha_composite(L("cards/slot.png", 2), (x0 + 12 + 2 * 88, py + 120))
    for i in range(4):
        img.alpha_composite(L("fx/crack.png", 2).crop((80 * 4, 0, 80 * 5, 112)), (x0 + 12 + 1 * 88, py)) if i == 0 else None
    img.alpha_composite(L("fx/crack.png", 2).crop((80 * 4, 0, 80 * 5, 112)), (x0 + 12 + 1 * 88, py + 120))
    # 神庙里的探险者，站在下一张牌旁边
    for i, (cid, *_r) in enumerate(S.PLAYERS[:5]):
        img.alpha_composite(L(f"players/explorer-{cid}.png", 2), (x0 + 12 + 3 * 88 + i * 34, py + 120 + 60))
    # 帐篷一排（8 人）
    ty = py + 2 * 120 + 12
    panel(img, (x0, ty, x0 + bw, ty + 150), day)
    names = ["阿宝", "小王", "咕噜一号", "阿杰", "Momo", "老张", "咕噜二号", "七七"]
    for i, (cid, hx, shape, _) in enumerate(S.PLAYERS):
        cx = x0 + 12 + i * 138 + 64
        home = i in (1, 4, 6)
        img.alpha_composite(L(f"players/tent-{cid}{'-home' if home else ''}.png", 2), (cx - 32, ty + 8))
        if not home:
            img.alpha_composite(L("choice/card-back.png" if i % 2 else "icons/wait.png", 2), (cx + 34, ty + 4))
        img.alpha_composite(L(f"players/mark-{cid}.png", 2), (cx - 64, ty + 64))
        txt(img, names[i], cx - 42, ty + 62, fg)
        img.alpha_composite(L("icons/gem.png", 2), (cx - 64, ty + 96))
        txt(img, "4", cx - 30, ty + 98, fg)
        img.alpha_composite(L("icons/artifact.png", 2), (cx - 4, ty + 96))
        txt(img, "1" if i == 2 else "0", cx + 30, ty + 98, fg)
    # 我的选择
    cy = ty + 162
    panel(img, (x0, cy, x0 + bw, H - 12), day)
    for k, (ic, label) in enumerate((("torch", "继续挖"), ("camp", "回营地"))):
        bx = x0 + bw // 2 - 300 + k * 320
        d.rectangle([bx, cy + 12, bx + 280, cy + 12 + 80], fill=(23, 52, 34) if k == 0 else (90, 62, 34), outline=(240, 153, 76) if k == 0 else (233, 194, 121), width=3)
        img.alpha_composite(L(f"choice/{ic}.png", 2), (bx + 16, cy + 20))
        txt(img, label, bx + 100, cy + 40, "#f6e8b8", 2)
    txt(img, "我手上 4 颗 · 帐篷 12 颗", x0 + 16, cy + 110 if cy + 110 < H - 40 else cy + 96, fg)
    return img

def mobile(day):
    W, H = 390, 664
    fg = "#2a2018" if day else "#f6e8b8"
    img = Image.new("RGBA", (W, H))
    cover(img, day)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 40], fill=(232, 222, 200) if day else (8, 14, 16))
    txt(img, "第 3 局 / 5", 12, 6, fg)
    txt(img, "剩 17", 280, 6, fg)
    y = 46
    x = 8
    for k, _ in S.HAZARDS:
        img.alpha_composite(L(f"icons/hazard-{k}.png", 2), (x, y))
        x += 34
        x += txt(img, "1", x, y + 2, fg) + 10
    img.alpha_composite(L("icons/gem.png", 2), (x, y)); txt(img, "3", x + 34, y + 2, fg)
    y += 40
    for i, c in enumerate(PATH):
        r, col = divmod(i, 8)
        img.alpha_composite(L(f"cards/{c}.png", 1), (8 + col * 47, y + r * 62))
    img.alpha_composite(L("cards/slot.png", 1), (8 + 6 * 47, y + 62))
    y += 3 * 62 + 4
    names = ["阿宝", "小王", "咕噜一号", "阿杰", "Momo", "老张", "咕噜二号", "七七"]
    for i, (cid, *_r) in enumerate(S.PLAYERS):
        r, col = divmod(i, 4)
        cx, cy = 8 + col * 95, y + r * 80
        home = i in (1, 4, 6)
        img.alpha_composite(L(f"players/tent-{cid}{'-home' if home else ''}.png", 1), (cx, cy))
        img.alpha_composite(L(f"players/mark-{cid}.png", 1), (cx + 36, cy + 2))
        if not home:
            img.alpha_composite(L("choice/card-back.png", 1), (cx + 56, cy - 4))
        txt(img, names[i][:3], cx, cy + 26, fg, 1)
        txt(img, "4颗", cx, cy + 44, fg, 2)
    y += 164
    for k, (ic, label) in enumerate((("torch", "继续挖"), ("camp", "回营地"))):
        bx = 8 + k * 190
        d.rectangle([bx, y, bx + 178, y + 72], fill=(23, 52, 34) if k == 0 else (90, 62, 34), outline=(240, 153, 76) if k == 0 else (233, 194, 121), width=3)
        img.alpha_composite(L(f"choice/{ic}.png", 2), (bx + 8, y + 4))
        txt(img, label, bx + 80, y + 22, "#f6e8b8", 2)
    return img

for day in (False, True):
    t = "day" if day else "night"
    desktop(day).save(OUT / f"desk-1440-{t}.png")
    mobile(day).save(OUT / f"mobile-390-{t}.png")
print("ok", OUT)
