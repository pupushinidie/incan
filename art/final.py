"""印加宝藏 正式美术导出：按 art/selection.json 选中的 PixelLab 候选，照 art/spec.md 的文件名、尺寸、帧数
合成到 art/out/final/（目录结构和 apps/web/public/art/ 一样）。**不碰 public/art**，换图验收时再覆盖。

- 卡框、数字、名字一直用 art/simple.py 的代码画；PixelLab 只给中间的插画。
- 帐篷、探险者：选中一张蓝色的，把蓝色区域按亮度做渐变映射，换成 8 个玩家色；帐篷门帘上再叠代码画的记号。
- 动画：火把用 PixelLab animate；宝石旋转、塌方用选中的宝石 / 石块在代码里排帧；闪光、裂纹用代码。
- 记号、分值徽章、「下一张」空位、地面、已决定图标、分隔条：代码画（简洁版就是正式版）。

用法：~/miniconda3/envs/quant/bin/python art/final.py           # 导出全部
      ~/miniconda3/envs/quant/bin/python art/final.py --check   # 核对 final 和 spec 一一对应、尺寸对
"""
from __future__ import annotations

import colorsys
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import simple as S  # noqa: E402

ART = Path(__file__).resolve().parent
FINAL = ART / "out" / "final"
SEL = json.loads((ART / "selection.json").read_text()) if (ART / "selection.json").exists() else {}
INK = S.INK
CLEAR = S.CLEAR


def src(key: str) -> Image.Image:
    return Image.open(ART / SEL[key]["src"]).convert("RGBA")


def save(img: Image.Image, rel: str) -> None:
    p = FINAL / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    img.save(p, optimize=True)
    WRITTEN.append(rel)


WRITTEN: list[str] = []


# ---------------- 通用处理 ----------------

def clean_alpha(img: Image.Image, thr: int = 128) -> Image.Image:
    """半透明边缘一律硬化：alpha < thr 的去掉，其余不透明。"""
    img = img.copy()
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= thr else CLEAR
    return img


def drop_specks(img: Image.Image, min_size: int = 3) -> Image.Image:
    """去掉和主体不连通的零星小点（v2 候选常带）。"""
    img = img.copy()
    px = img.load()
    w, h = img.size
    seen = set()
    for y in range(h):
        for x in range(w):
            if px[x, y][3] and (x, y) not in seen:
                comp, stack = [], [(x, y)]
                seen.add((x, y))
                while stack:
                    cx, cy = stack.pop()
                    comp.append((cx, cy))
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] and (nx, ny) not in seen:
                            seen.add((nx, ny))
                            stack.append((nx, ny))
                if len(comp) < min_size:
                    for c in comp:
                        px[c] = CLEAR
    return img


def trim(img: Image.Image) -> Image.Image:
    box = img.getbbox()
    return img.crop(box) if box else img


def fit(img: Image.Image, w: int, h: int) -> Image.Image:
    """裁掉四周空白后居中放进 w×h（放不下就报错，不缩放，保持像素）。"""
    t = trim(img)
    if t.width > w or t.height > h:
        raise ValueError(f"{t.size} 放不进 {w}×{h}")
    out = Image.new("RGBA", (w, h), CLEAR)
    out.alpha_composite(t, ((w - t.width) // 2, (h - t.height) // 2))
    return out


def fit_bottom(img: Image.Image, w: int, h: int) -> Image.Image:
    t = trim(img)
    if t.width > w or t.height > h:
        raise ValueError(f"{t.size} 放不进 {w}×{h}")
    out = Image.new("RGBA", (w, h), CLEAR)
    out.alpha_composite(t, ((w - t.width) // 2, h - t.height))
    return out


def prep(key: str, w: int, h: int, bottom=False) -> Image.Image:
    img = drop_specks(clean_alpha(src(key)), SEL[key].get("speck", 3))
    for box in SEL[key].get("erase", []):  # 手工抹掉的区域 [x0,y0,x1,y1]
        ImageDraw.Draw(img).rectangle(box, fill=CLEAR)
    return (fit_bottom if bottom else fit)(img, w, h)


def hsv(p):
    return colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)


def recolor(img: Image.Image, target_hex: str, hue=(0.53, 0.72), sat=0.22, region=None) -> Image.Image:
    """把蓝色区域（色相 hue 范围、饱和度 > sat，可再限定矩形 region）按亮度渐变映射到目标色：
    最暗 → 目标色压暗 55%，中间 → 目标色，最亮 → 目标色提亮 45%。白色目标整体压一点，免得糊成白片。"""
    out = img.copy()
    px = out.load()
    pts = []
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            if region and not (region[0] <= x <= region[2] and region[1] <= y <= region[3]):
                continue
            h, s, v = hsv((r, g, b))
            if hue[0] <= h <= hue[1] and s > sat:
                pts.append((x, y, 0.299 * r + 0.587 * g + 0.114 * b))
    if not pts:
        return out
    lo = min(p[2] for p in pts)
    hi = max(p[2] for p in pts)
    tgt = S.rgb(target_hex)
    is_light = sum(tgt[:3]) > 600
    dark = S.darken(tgt, 0.62 if is_light else 0.55)
    light = S.lighten(tgt, 0.2 if is_light else 0.45)
    mid = S.darken(tgt, 0.12) if is_light else tgt
    for x, y, l in pts:
        t = (l - lo) / (hi - lo) if hi > lo else 0.5
        if t < 0.55:
            c = S.mix(dark, mid, t / 0.55)
        else:
            c = S.mix(mid, light, (t - 0.55) / 0.45)
        px[x, y] = c[:3] + (255,)
    return out


# ---------------- 卡面 ----------------

def card_frame(kind: str) -> Image.Image:
    if kind == "treasure":
        return S.card_base(S.C["jungle"], S.C["jungle_l"], S.C["jungle_d"], S.C["slate"], S.C["slate_l"])
    if kind == "hazard":
        img = S.card_base(S.C["blood"], S.C["blood_l"], S.C["blood_d"], S.C["slate"], S.C["slate_l"])
        d = ImageDraw.Draw(img)
        for y in range(4, S.CARD_H - 16, 4):
            d.point((3, y), fill=S.C["red"])
            d.point((S.CARD_W - 4, y + 2), fill=S.C["red"])
        return img
    img = S.card_base(S.C["relic"], S.C["relic_l"], S.darken(S.C["relic"], 0.3), S.C["gold_m"], S.C["gold_l"], gold_trim=True)
    d = ImageDraw.Draw(img)
    cx, cy = S.CARD_W // 2, 21
    for i in range(16):
        a = i / 16 * math.tau
        for r in range(12, 19, 2):
            x, y = round(cx + math.cos(a) * r), round(cy + math.sin(a) * r)
            if 3 <= x < S.CARD_W - 3 and 4 <= y < S.CARD_H - 16:
                d.point((x, y), fill=S.C["relic_l"])
    return img


def illus_window(card: Image.Image, ill: Image.Image) -> None:
    """插画 34×36 放在 (3,4)：名字条上面那一块。"""
    card.alpha_composite(ill, (3, 4))


def treasure(v: int) -> Image.Image:
    img = card_frame("treasure")
    t = S.text_img(str(v), S.C["cream"], 2, INK)
    tier = "gems-s" if v <= 4 else "gems-m" if v <= 9 else "gems-l"
    pile = prep(tier, 34, 52 - 3 - t.height, bottom=True)
    img.alpha_composite(pile, (3, 3 + t.height))
    img.alpha_composite(t, ((S.CARD_W - t.width) // 2, 3))
    return img


def hazard(kind: str, name: str) -> Image.Image:
    img = card_frame("hazard")
    illus_window(img, prep(f"hz-{kind}", 34, 36))
    S.name_band(img, name, S.C["torch_l"])
    return img


def artifact(n: int, key: str, name: str) -> Image.Image:
    img = card_frame("artifact")
    illus_window(img, prep(key, 34, 36))
    S.name_band(img, name, S.C["gold"])
    return img


def back() -> Image.Image:
    img = S.card_base(S.C["stone1"], S.C["stone2"], S.C["stone0"], S.C["slate"], S.C["slate_l"])
    b = src("back").crop((0, 0, 36, 52))
    img.alpha_composite(b.crop((1, 1, 35, 51)), (3, 3))  # 内框 34×50，保留代码画的石板框
    return img


# ---------------- 玩家 ----------------

def tent_img(hexcol: str, shape: str, home: bool) -> Image.Image:
    key = "tent-home" if home else "tent"
    base = prep(key, 32, 24, bottom=True)
    reg = SEL[key].get("region")
    img = recolor(base, hexcol, region=reg)
    mk = S.mark(shape, S.rgb(hexcol) if home else S.lighten(S.rgb(hexcol), 0.3), 9)
    mx, my = SEL[key].get("mark", (12, 12))
    img.alpha_composite(mk, (mx, my))
    return img


def explorer_img(hexcol: str) -> Image.Image:
    base = prep("explorer", 16, 24, bottom=True)
    return recolor(base, hexcol, region=SEL["explorer"].get("region"))


# ---------------- 选择 ----------------

def choice_card(kind: str) -> Image.Image:
    W, H = 24, 32
    img = Image.new("RGBA", (W, H), CLEAR)
    d = ImageDraw.Draw(img)
    body, frame = {"torch": (S.C["jungle"], S.C["torch"]), "camp": (S.rgb("#6a4a2a"), S.C["sand"]),
                   "back": (S.C["stone1"], S.C["slate_l"])}[kind]
    d.rectangle([0, 0, W - 1, H - 1], fill=INK)
    d.rectangle([1, 1, W - 2, H - 2], fill=frame)
    d.rectangle([2, 2, W - 3, H - 3], fill=body)
    for c in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]:
        img.putpixel(c, CLEAR)
    if kind == "back":
        ch = S.bevel(S.outline(S.chakana(11, S.C["gold_m"], 1)), 0.4, 0.3)
        img.alpha_composite(ch, ((W - ch.width) // 2, (H - ch.height) // 2))
    else:
        icon = prep("ic-torch" if kind == "torch" else "ic-camp", 20, 28)
        img.alpha_composite(icon, (2, 2))
    return img


# ---------------- 动画 ----------------

def fx_torch() -> Image.Image:
    """火把：PixelLab animate 出的帧（32×32 画布中间 16 列），选中的那组，按 selection 里的帧序排。"""
    sel = SEL["fx-torch"]
    frames = []
    for f in sel["frames"]:
        im = clean_alpha(Image.open(ART / f).convert("RGBA"))
        x0 = sel.get("crop_x", (im.width - 16) // 2)
        frames.append(im.crop((x0, im.height - 32, x0 + 16, im.height)))
    return S.strip(frames)


def fx_gem_spin() -> Image.Image:
    g = trim(prep("ic-gem", 16, 16))
    frames = []
    for w in (g.width, round(g.width * 0.75), round(g.width * 0.45), max(2, round(g.width * 0.2)), round(g.width * 0.45), round(g.width * 0.75)):
        f = Image.new("RGBA", (16, 16), CLEAR)
        sq = g.resize((max(1, w), g.height), Image.NEAREST)
        if w < g.width * 0.5:  # 侧面朝向时压暗一档，像转过去了
            sq = Image.eval(sq, lambda v: v)
        f.alpha_composite(sq, ((16 - sq.width) // 2, (16 - sq.height) // 2))
        frames.append(f)
    return S.strip(frames)


def fx_collapse() -> Image.Image:
    """塌方 64×64 × 10：选中的几块石头（PixelLab）从上面砸下，落地后扬起烟尘（代码抖动点），最后一帧几乎透明。"""
    rocks = [prep(k, 16, 16) for k in SEL["boulders"]["keys"]]
    rnd = random.Random(11)
    items = []
    for i in range(9):
        r = rocks[i % len(rocks)]
        if i % 3 == 2:
            r = r.resize((max(4, r.width * 2 // 3), max(4, r.height * 2 // 3)), Image.NEAREST)
        if i % 2:
            r = r.transpose(Image.FLIP_LEFT_RIGHT)
        items.append((r, rnd.randint(0, 64 - r.width), -rnd.randint(r.height, 40), rnd.randint(11, 15)))
    puffs = [(rnd.uniform(-1, 1), rnd.uniform(0.3, 1.0), rnd.randint(4, 8)) for _ in range(16)]
    frames = []
    for i in range(10):
        f = Image.new("RGBA", (64, 64), CLEAR)
        for r, x, y0, vy in items:
            y = min(y0 + i * vy, 63 - r.height)
            landed = y0 + i * vy >= 63 - r.height
            if i >= 8 or (landed and i >= 7):
                continue
            f.alpha_composite(r, (x, y))
        if i >= 3:
            k = i - 3
            dust = Image.new("RGBA", (64, 64), CLEAR)
            dd = ImageDraw.Draw(dust)
            a_ = max(0, 230 - k * 34)
            for dx, up, rr0 in puffs:
                cx = 32 + dx * (8 + k * 4.5)
                cy = 60 - up * (2 + k * 3.2)
                rr = rr0 + k // 2
                dd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(196, 186, 160, a_) if rr0 % 2 else (150, 140, 120, a_))
            dp = dust.load()
            for yy in range(64):
                for xx in range(64):
                    if dp[xx, yy][3] and ((xx * 73856093 ^ yy * 19349663 ^ 83492791) % 7) < k:
                        dp[xx, yy] = CLEAR
            f.alpha_composite(dust)
        frames.append(f)
    return S.strip(frames)


# ---------------- 汇总 ----------------

def build() -> None:
    for v in S.TREASURES:
        save(treasure(v), f"cards/treasure-{v}.png")
    for k, name in S.HAZARDS:
        save(hazard(k, name), f"cards/hazard-{k}.png")
    for n, key in enumerate(["af-mask", "af-llama", "af-sun", "af-tumi", "af-idol"], 1):
        save(artifact(n, key, S.ARTIFACTS[n - 1][1]), f"cards/artifact-{n}.png")
    save(back(), "cards/back.png")
    save(S.card_slot(), "cards/slot.png")

    for cid, hx, shape, _ in S.PLAYERS:
        save(tent_img(hx, shape, False), f"players/tent-{cid}.png")
        save(tent_img(hx, shape, True), f"players/tent-{cid}-home.png")
        save(explorer_img(hx), f"players/explorer-{cid}.png")
        save(S.mark(shape, S.rgb(hx), 10), f"players/mark-{cid}.png")

    save(prep("ch-torch", 32, 32), "choice/torch.png")
    save(prep("ch-camp", 32, 32), "choice/camp.png")
    for k in ("torch", "camp", "back"):
        save(choice_card(k), f"choice/card-{k}.png")

    for k in ("gem", "artifact", "deck", "tent", "torch", "camp", "wait", "skull", "crown", "temple"):
        save(prep(f"ic-{k}", 16, 16), f"icons/{k}.png")
    save(S.icon_hidden(), "icons/hidden.png")
    for k, _ in S.HAZARDS:
        save(prep(f"ic-{k}", 16, 16), f"icons/hazard-{k}.png")

    for t in ("night", "day"):
        save(src(f"scene-{t}").crop((0, 0, 512, 288)).convert("RGBA"), f"scene/{t}.png")
    save(S.floor_tile(False), "table/floor-night.png")
    save(S.floor_tile(True), "table/floor-day.png")

    save(fx_torch(), "fx/torch.png")
    save(fx_gem_spin(), "fx/gem-spin.png")
    save(S.fx_sparkle(), "fx/sparkle.png")
    save(fx_collapse(), "fx/collapse.png")
    save(S.fx_crack(), "fx/crack.png")

    save(prep("banner", 160, 32), "ui/banner.png")
    save(prep("chest", 64, 48), "ui/chest.png")
    save(S.ui_divider(), "ui/divider.png")
    save(S.ui_badge(5), "ui/badge-5.png")
    save(S.ui_badge(10), "ui/badge-10.png")
    print(f"写了 {len(WRITTEN)} 个文件到 {FINAL}")


if __name__ == "__main__":
    if "--check" in sys.argv:
        S.OUT = FINAL
        sys.exit(1 if S.check() else 0)
    build()
