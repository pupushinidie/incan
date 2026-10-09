"""印加宝藏「简洁版」美术：全部用代码画（PIL），不调 PixelLab，能直接上线。
正式美术（PixelLab）定稿后按 art/spec.md 的同一批文件名、尺寸、帧数覆盖。

用法（仓库根目录）：
    ~/miniconda3/envs/quant/bin/python art/simple.py              # 画全部，写进 apps/web/public/art/
    ~/miniconda3/envs/quant/bin/python art/simple.py --check      # 核对 spec.md 列出的文件和 public/art 一一对应、尺寸对
    ~/miniconda3/envs/quant/bin/python art/simple.py --colors     # 打印 8 个玩家色在色盲模拟下的最小色差

风格照 art/spec.md 第 1 节「丛林神庙火把夜探」：
- 光从左上来（亮边在左上、暗边在右下），硬边、不抗锯齿，1px 深色描边 INK。
- 卡面：分类底色（宝物=丛林绿、危险=暗红、神器=深褐金框）+ 大号数字或代码画的图标 + 名字（Fusion Pixel 12px）。
- 数字用 Fusion Pixel 12px 渲染后整数倍放大（卡面上是 2 倍），不让模型写字。
"""
from __future__ import annotations

import math
import random
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, PngImagePlugin

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "art"
WOFF2 = ROOT / "apps" / "web" / "src" / "assets" / "pixel" / "fusion-pixel-12px-zh_hans.woff2"
FONT_CACHE = ROOT / "art" / "out" / "fusion12.ttf"
SPEC = ROOT / "art" / "spec.md"

CLEAR = (0, 0, 0, 0)


def rgb(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


# ---------------- 调色板（取自开工样张 style-torch-night/day，见 spec 1.2） ----------------
PAL = {
    "ink": "#0b0809",          # 描边（最深）
    "shadow": "#071115",       # 夜景最暗处
    "stone0": "#0c1a1c",       # 夜间石墙暗
    "stone1": "#122e22",       # 夜间石墙中（苔绿）
    "stone2": "#1f3d2f",       # 夜间石墙亮
    "slate": "#262d40",        # 卡框石板
    "slate_l": "#4a5468",      # 卡框亮边
    "moss": "#3f4526",
    "moss_l": "#b5b76d",       # 被火光照亮的苔石
    "torch": "#f0994c",        # 火把橙
    "torch_l": "#ffd27a",      # 火心
    "torch_d": "#c8501e",      # 火焰外沿
    "gem_l": "#c8f5d8",        # 宝石高光
    "gem": "#82dba3",          # 宝石亮
    "gem_m": "#2fa878",        # 宝石中
    "gem_d": "#1d6a4a",        # 宝石暗
    "jungle": "#173422",       # 宝物卡底
    "jungle_l": "#24503a",
    "jungle_d": "#0e2116",
    "blood": "#33101a",        # 危险卡底
    "blood_l": "#5a1c28",
    "blood_d": "#1e0910",
    "relic": "#3e2420",        # 神器卡底
    "relic_l": "#5a3626",
    "gold": "#f8d26e",         # 金
    "gold_l": "#fff2b8",
    "gold_m": "#d09a3a",
    "gold_d": "#844312",
    "cream": "#f6e8b8",        # 牌面数字、名字
    "wood": "#9b6e41",
    "wood_d": "#5f492f",
    "sand": "#e9c279",         # 白天沙石
    "sand_d": "#c49a58",
    "dayleaf": "#96a867",
    "dayleaf_d": "#566441",
    "bone": "#e4dcc4",
    "bone_d": "#a89a78",
    "rock": "#8a8478",
    "rock_l": "#b8b2a2",
    "rock_d": "#544f48",
    "snake": "#7cbc3c",
    "snake_l": "#c4e070",
    "snake_d": "#3e6e1e",
    "spider": "#3a2c4a",
    "spider_l": "#6a5a84",
    "red": "#d8301e",
    "skin": "#e0a878",
    "skin_d": "#a8683e",
}
C = {k: rgb(v) for k, v in PAL.items()}
INK = C["ink"]

# 8 个玩家色（座位 0–7）+ 记号。色盲模拟（deutan/protan/tritan）下两两色差 ≥16，再加记号兜底。
PLAYERS = [
    ("red", "#d63c2c", "circle", "赤"),
    ("blue", "#2d5fe0", "triangle", "蓝"),
    ("yellow", "#f7dc4a", "square", "黄"),
    ("green", "#2e9e4a", "diamond", "绿"),
    ("purple", "#b98af0", "star", "紫"),
    ("orange", "#f5962a", "plus", "橙"),
    ("cyan", "#5fdce4", "moon", "青"),
    ("white", "#f2eee4", "heart", "白"),
]

TREASURES = [1, 2, 3, 4, 5, 7, 9, 11, 13, 14, 15, 17]
HAZARDS = [("fire", "火焰"), ("mummy", "木乃伊"), ("rocks", "落石"), ("snake", "蛇"), ("spider", "蜘蛛")]
ARTIFACTS = [(1, "面具"), (2, "羊驼"), (3, "日轮"), (4, "祭刀"), (5, "神像")]

CARD_W, CARD_H = 40, 56


# ---------------- 基础工具 ----------------

def load_font() -> ImageFont.FreeTypeFont:
    if not FONT_CACHE.exists():
        from fontTools.ttLib import TTFont

        FONT_CACHE.parent.mkdir(parents=True, exist_ok=True)
        f = TTFont(str(WOFF2))
        f.flavor = None
        f.save(str(FONT_CACHE))
    return ImageFont.truetype(str(FONT_CACHE), 12)


FONT = load_font()


def mix(a, b, t: float):
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(3)) + (a[3] if len(a) > 3 else 255,)


def lighten(c, t=0.3):
    return mix(c, (255, 248, 225, 255), t)


def darken(c, t=0.3):
    return mix(c, (6, 10, 12, 255), t)


def new(w, h, fill=CLEAR) -> Image.Image:
    return Image.new("RGBA", (w, h), fill)


def outline(img: Image.Image, color=INK, diagonal=False) -> Image.Image:
    """给不透明区域外面加一圈 1px 描边（画在透明像素上）。"""
    out = img.copy()
    w, h = img.size
    sp, op = img.load(), out.load()
    nb = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (-1, -1), (1, -1), (-1, 1)] if diagonal else [])
    for y in range(h):
        for x in range(w):
            if sp[x, y][3]:
                continue
            for dx, dy in nb:
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and sp[nx, ny][3] > 0:
                    op[x, y] = color
                    break
    return out


def bevel(img: Image.Image, light=0.35, dark=0.35, skip=(INK,)) -> Image.Image:
    """左上亮边、右下暗边（只看透明或描边邻居），平涂色块有一点体积。"""
    src = img.copy()
    out = img.copy()
    w, h = img.size
    sp, op = src.load(), out.load()
    skipset = {c[:3] for c in skip}

    def empty(x, y):
        return not (0 <= x < w and 0 <= y < h) or sp[x, y][3] == 0 or sp[x, y][:3] in skipset

    for y in range(h):
        for x in range(w):
            p = sp[x, y]
            if not p[3] or p[:3] in skipset:
                continue
            if empty(x - 1, y) or empty(x, y - 1):
                op[x, y] = lighten(p, light)[:3] + (p[3],)
            elif empty(x + 1, y) or empty(x, y + 1):
                op[x, y] = darken(p, dark)[:3] + (p[3],)
    return out


def paste(dst: Image.Image, src: Image.Image, x: int, y: int) -> None:
    dst.alpha_composite(src, (x, y))


def text_img(s: str, color, scale: int = 1, ink=INK, shadow=False) -> Image.Image:
    """Fusion Pixel 12px 渲染，整数倍放大，外加 1px 描边（原图像素）。"""
    d0 = ImageDraw.Draw(new(1, 1))
    x0, y0, x1, y1 = d0.textbbox((0, 0), s, font=FONT)
    w, h = x1 - x0, y1 - y0
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    d.fontmode = "1"
    d.text((-x0, -y0), s, font=FONT, fill=255)
    if scale > 1:
        m = m.resize((w * scale, h * scale), Image.NEAREST)
    g = new(m.width + 2, m.height + 2 + (scale if shadow else 0))
    solid = new(m.width, m.height, color)
    if shadow:
        sh = new(m.width, m.height, ink)
        g.paste(sh, (1, 1 + scale), m)
    g.paste(solid, (1, 1), m)
    if ink is not None:
        g = outline(g, ink, diagonal=True)
    return g


def put_text(img, s, cx, cy, color, scale=1, ink=INK, shadow=False):
    t = text_img(s, color, scale, ink, shadow)
    paste(img, t, cx - t.width // 2, cy - t.height // 2)
    return t


def save(img: Image.Image, rel: str) -> None:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    info = PngImagePlugin.PngInfo()
    info.add_text("tier", "simple")
    img.save(p, pnginfo=info, optimize=True)
    WRITTEN.append(rel)


WRITTEN: list[str] = []


def strip(frames: list[Image.Image]) -> Image.Image:
    w, h = frames[0].size
    s = new(w * len(frames), h)
    for i, f in enumerate(frames):
        s.paste(f, (i * w, 0))
    return s


def poly(d: ImageDraw.ImageDraw, pts, fill):
    d.polygon([(round(x), round(y)) for x, y in pts], fill=fill)


# ---------------- 小物件：宝石、火把、神器、危险 ----------------

def gem(w: int) -> Image.Image:
    """正面切割的宝石：上冠梯形（左亮右中）+ 下亭三角（左中右暗）+ 台面高光，外描边。w 是宝石宽（不含描边）。"""
    w = max(5, w)
    hc = max(2, round(w * 0.32))
    hp = max(3, round(w * 0.5))
    img = new(w + 2, hc + hp + 2)
    d = ImageDraw.Draw(img)
    ox, oy = 1, 1
    inset = max(1, w // 4)
    mid = ox + (w - 1) / 2
    # 冠
    poly(d, [(ox + inset, oy), (ox + w - 1 - inset, oy), (ox + w - 1, oy + hc - 1), (ox, oy + hc - 1)], C["gem"])
    poly(d, [(mid, oy), (ox + w - 1 - inset, oy), (ox + w - 1, oy + hc - 1), (mid, oy + hc - 1)], C["gem_m"])
    # 亭
    poly(d, [(ox, oy + hc), (ox + w - 1, oy + hc), (mid, oy + hc + hp - 1)], C["gem_m"])
    poly(d, [(mid, oy + hc), (ox + w - 1, oy + hc), (mid, oy + hc + hp - 1)], C["gem_d"])
    poly(d, [(ox + 1, oy + hc), (mid - 1, oy + hc), (mid, oy + hc + hp - 2)], C["gem"])
    # 台面高光
    d.line([(ox + inset, oy), (ox + inset + max(1, w // 5), oy)], fill=C["gem_l"])
    if hc >= 3:
        d.point((ox + inset - 1, oy + 1), fill=C["gem_l"])
    img = outline(img)
    return img


def gem_pile(n: int, gw: int = 9) -> Image.Image:
    """n 颗宝石堆成金字塔（底下多、上面少）。"""
    g = gem(gw)
    gwid, ght = g.size
    b = 1
    while b * (b + 1) // 2 < n:
        b += 1
    rows = list(range(b, 0, -1))  # 底层 b 颗，往上依次少一颗
    extra = sum(rows) - n
    while extra > 0:  # 多出来的从顶层拿掉
        take = min(extra, rows[-1])
        rows[-1] -= take
        extra -= take
        if rows[-1] == 0:
            rows.pop()
    rows = rows[::-1]  # rows[0] 是顶层
    # 画布
    maxrow = max(rows)
    dx = gwid - 3
    dy = ght - 5
    W = maxrow * dx + 3
    H = (len(rows) - 1) * dy + ght
    img = new(W, H)
    for r, cnt in enumerate(rows):  # r=0 顶层
        y = r * dy
        x0 = (W - (cnt * dx + 3)) // 2
        for i in range(cnt):
            paste(img, g, x0 + i * dx, y)
    return img


def pile_count(v: int) -> int:
    return {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 7: 6, 9: 6, 11: 7, 13: 8, 14: 9, 15: 9, 17: 10}[v]


def flame(w: int, h: int, phase: float = 0.0, layers=("torch_d", "torch", "torch_l")) -> Image.Image:
    """泪滴形火苗，三层（外红、中橙、芯黄）。phase 让火舌左右摆，用来做动画。"""
    img = new(w, h)
    d = ImageDraw.Draw(img)
    for li, key in enumerate(layers):
        s = 1 - li * 0.3
        fw = w * s
        fh = h * (1 - li * 0.22)
        cx = (w - 1) / 2 + math.sin(phase + li) * 0.8 * (1 - li * 0.3)
        base = h - 1
        pts = []
        steps = 14
        for i in range(steps + 1):
            t = i / steps
            yy = base - t * (fh - 1)
            # 底部圆、顶部尖；火舌摆动
            half = (fw / 2) * math.sqrt(max(0.0, 1 - t)) * (0.9 + 0.1 * math.sin(t * 6 + phase * 2))
            sway = math.sin(t * 3.2 + phase) * w * 0.14 * t
            pts.append((cx - half + sway, yy))
        right = []
        for i in range(steps, -1, -1):
            t = i / steps
            yy = base - t * (fh - 1)
            half = (fw / 2) * math.sqrt(max(0.0, 1 - t)) * (0.9 + 0.1 * math.sin(t * 6 + phase * 2 + 1))
            sway = math.sin(t * 3.2 + phase) * w * 0.14 * t
            right.append((cx + half + sway, yy))
        poly(d, pts + right, C[key])
    return img


def torch_stick(w=16, h=32, phase=0.0, outlined=True) -> Image.Image:
    """火把：木柄 + 缠布 + 火苗。"""
    img = new(w, h)
    d = ImageDraw.Draw(img)
    cx = w // 2
    # 木柄（略斜）
    for y in range(h // 2, h - 1):
        x = cx - 1 + (y - h // 2) // 6
        d.line([(x, y), (x + 2, y)], fill=C["wood"])
        d.point((x + 2, y), fill=C["wood_d"])
    # 缠布头
    d.rectangle([cx - 3, h // 2 - 2, cx + 3, h // 2 + 1], fill=C["wood_d"])
    d.line([(cx - 3, h // 2 - 2), (cx + 3, h // 2 - 2)], fill=C["bone_d"])
    f = flame(w - 4, h // 2 + 1, phase)
    paste(img, f, 2, 0)
    return outline(img) if outlined else img


def draw_hazard(kind: str, S: int) -> Image.Image:
    """危险图标，画在 S×S 画布上（S=28 卡面用，S=14 小图标用），透明底，外描边。"""
    img = new(S, S)
    d = ImageDraw.Draw(img)
    u = S / 28.0

    def P(x, y):
        return (round(x * u), round(y * u))

    if kind == "fire":
        # 柴堆 + 大火
        d.rectangle([P(5, 23), P(23, 25)], fill=C["wood_d"])
        d.line([P(4, 25), P(24, 22)], fill=C["wood"], width=max(1, round(2 * u)))
        d.line([P(4, 22), P(24, 25)], fill=C["wood"], width=max(1, round(2 * u)))
        f = flame(round(22 * u), round(24 * u), 0.6, ("red", "torch", "torch_l"))
        paste(img, f, round(3 * u), 0)
        # 两条小火舌
        f2 = flame(max(3, round(7 * u)), max(4, round(11 * u)), 2.0, ("red", "torch", "torch_l"))
        paste(img, f2, 0, round(12 * u))
        paste(img, f2.transpose(Image.FLIP_LEFT_RIGHT), S - f2.width, round(11 * u))
    elif kind == "mummy":
        # 头 + 肩，缠满绷带，两只红眼
        d.rounded_rectangle([P(7, 2), P(21, 17)], radius=max(1, round(5 * u)), fill=C["bone"])
        d.rounded_rectangle([P(2, 16), P(26, 27)], radius=max(1, round(4 * u)), fill=C["bone"])
        step = max(2, round(3 * u))
        for y in range(round(4 * u), S, step):
            for x0 in range(0, S, max(4, round(7 * u))):
                xx = x0 + (y // step) % 3
                if img.getpixel((min(S - 1, xx), y))[3]:
                    d.line([(xx, y), (xx + max(2, round(4 * u)), y + (1 if (y // step) % 2 else 0))], fill=C["bone_d"])
        d.rectangle([P(8, 8), P(20, 11)], fill=C["blood_d"])
        d.rectangle([P(10, 9), P(12, 10)], fill=C["red"])
        d.rectangle([P(16, 9), P(18, 10)], fill=C["red"])
        if S >= 20:
            d.point(P(11, 9), fill=C["torch_l"])
            d.point(P(17, 9), fill=C["torch_l"])
        # 垂下的绷带
        d.line([P(22, 17), P(25, 26)], fill=C["bone_d"], width=max(1, round(2 * u)))
    elif kind == "rocks":
        # 三块落下的大石 + 速度线
        def boulder(cx, cy, r, col):
            pts = []
            for i in range(7):
                a = i / 7 * math.tau + 0.4
                rr = r * (0.82 + 0.18 * ((i * 37) % 5) / 4)
                pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
            poly(d, [(x * u, y * u) for x, y in pts], col)
        for x in (6, 13, 20):
            d.line([P(x, 1), P(x, 6)], fill=C["rock_l"])
        boulder(9, 19, 8, C["rock"])
        boulder(21, 13, 6, C["rock_l"])
        boulder(19, 24, 4, C["rock_d"])
        d.point(P(4, 26), fill=C["rock_l"])
        d.point(P(26, 26), fill=C["rock"])
    elif kind == "snake":
        # 盘成 S 的蛇，抬头吐信
        r = max(1.5, 2.6 * u)
        pts = []
        for i in range(60):
            t = i / 59
            x = 6 + 16 * t
            y = 22 - 4 * math.sin(t * math.tau * 1.0) - 2 * t
            pts.append((x, y))
        # 身体：沿路径画圆
        for x, y in pts:
            d.ellipse([x * u - r, y * u - r, x * u + r, y * u + r], fill=C["snake"])
        # 脖子 + 头
        neck = [(22, 20 - k * 1.2) for k in range(9)]
        for x, y in neck:
            d.ellipse([x * u - r, y * u - r, x * u + r, y * u + r], fill=C["snake"])
        d.ellipse([P(17, 3), P(26, 10)], fill=C["snake"])
        # 斑纹
        for i in range(4, 60, 9):
            x, y = pts[i]
            d.point((round(x * u), round(y * u)), fill=C["snake_d"])
        # 眼和信子
        d.point(P(19, 5), fill=C["torch_l"])
        d.line([P(16, 8), P(13, 8)], fill=C["red"])
        if S >= 20:
            d.point(P(12, 7), fill=C["red"])
            d.point(P(12, 9), fill=C["red"])
    elif kind == "spider":
        # 吊丝 + 身体 + 八条腿
        d.line([P(14, 0), P(14, 8)], fill=C["bone"])
        lw = max(1, round(1.4 * u))
        for side in (-1, 1):
            for k, (a, b) in enumerate([((6, -4), (10, -8)), ((7, -1), (12, -3)), ((7, 3), (12, 6)), ((6, 6), (9, 11))]):
                x1, y1 = 14 + side * a[0], 16 + a[1]
                x2, y2 = 14 + side * b[0], 16 + b[1]
                d.line([P(14 + side * 3, 16), P(x1, y1)], fill=C["spider_l"], width=lw)
                d.line([P(x1, y1), P(x2, y2)], fill=C["spider_l"], width=lw)
        d.ellipse([P(8, 12), P(20, 26)], fill=C["spider"])
        d.ellipse([P(10, 8), P(18, 15)], fill=C["spider"])
        d.rectangle([P(13, 17), P(15, 22)], fill=C["red"])
        d.point(P(12, 10), fill=C["red"])
        d.point(P(16, 10), fill=C["red"])
    img = bevel(img, 0.3, 0.3)
    return outline(img)


def draw_artifact(n: int, S: int) -> Image.Image:
    """五件不同的金色文物，S×S 透明画布。1 面具 2 羊驼 3 日轮 4 祭刀（图米刀）5 神像。"""
    img = new(S, S)
    d = ImageDraw.Draw(img)
    u = S / 28.0

    def P(x, y):
        return (round(x * u), round(y * u))

    G, Gm, Gd, Gl = C["gold"], C["gold_m"], C["gold_d"], C["gold_l"]
    tq = C["gem"]
    if n == 1:  # 金面具：头冠尖角 + 脸 + 眼缝 + 绿松石镶嵌
        for i, x in enumerate((5, 9, 14, 19, 23)):
            h = 1 if i == 2 else (3 if i in (1, 3) else 5)
            poly(d, [P(x - 2, 9), P(x, h), P(x + 2, 9)], Gm)
        d.rounded_rectangle([P(5, 7), P(23, 26)], radius=max(1, round(6 * u)), fill=G)
        d.rectangle([P(5, 8), P(23, 10)], fill=Gm)
        for x in (8, 13, 18):
            d.rectangle([P(x, 8), P(x + 2, 9)], fill=tq)
        d.rectangle([P(8, 14), P(12, 15)], fill=INK)
        d.rectangle([P(16, 14), P(20, 15)], fill=INK)
        d.line([P(14, 15), P(14, 19)], fill=Gd)
        d.rectangle([P(11, 21), P(17, 22)], fill=Gd)
        d.rectangle([P(3, 15), P(4, 19)], fill=Gm)
        d.rectangle([P(24, 15), P(25, 19)], fill=Gm)
    elif n == 2:  # 金羊驼（侧面小雕像）
        d.rounded_rectangle([P(5, 13), P(21, 20)], radius=max(1, round(3 * u)), fill=G)
        d.rectangle([P(17, 4), P(21, 14)], fill=G)
        d.rounded_rectangle([P(17, 3), P(25, 7)], radius=max(1, round(2 * u)), fill=G)
        d.rectangle([P(18, 1), P(19, 3)], fill=Gm)
        for x in (6, 9, 16, 19):
            d.rectangle([P(x, 20), P(x + 1, 26)], fill=Gm)
        d.rectangle([P(3, 13), P(5, 16)], fill=Gm)
        d.point(P(22, 4), fill=INK)
        d.rectangle([P(8, 15), P(15, 16)], fill=C["red"])
        d.rectangle([P(3, 26), P(23, 27)], fill=Gd)
    elif n == 3:  # 太阳盘：光芒 + 圆盘 + 脸
        cx, cy = 14, 14
        for i in range(12):
            a = i / 12 * math.tau
            r1, r2 = 9, 13.5
            w = 0.22
            poly(d, [((cx + math.cos(a - w) * r1) * u, (cy + math.sin(a - w) * r1) * u),
                     ((cx + math.cos(a) * r2) * u, (cy + math.sin(a) * r2) * u),
                     ((cx + math.cos(a + w) * r1) * u, (cy + math.sin(a + w) * r1) * u)], Gm if i % 2 else G)
        d.ellipse([P(5, 5), P(23, 23)], fill=G)
        d.ellipse([P(8, 8), P(20, 20)], fill=Gm)
        d.ellipse([P(9, 9), P(19, 19)], fill=G)
        d.rectangle([P(11, 12), P(12, 13)], fill=INK)
        d.rectangle([P(16, 12), P(17, 13)], fill=INK)
        d.rectangle([P(12, 16), P(16, 17)], fill=Gd)
    elif n == 4:  # 图米祭刀：半月形刀刃 + 刀柄 + 顶上小人像
        d.pieslice([P(4, 13), P(24, 33)], 0, 180, fill=G)
        d.pieslice([P(6, 15), P(22, 31)], 0, 180, fill=Gm)
        d.rectangle([P(4, 22), P(24, 23)], fill=Gd)
        d.rectangle([P(12, 9), P(16, 22)], fill=G)
        d.rectangle([P(10, 4), P(18, 9)], fill=G)
        for x in (10, 13, 16):
            d.rectangle([P(x, 1), P(x + 2, 4)], fill=Gm)
        d.rectangle([P(12, 6), P(12, 6)], fill=INK)
        d.rectangle([P(16, 6), P(16, 6)], fill=INK)
        d.rectangle([P(12, 13), P(16, 14)], fill=tq)
        d.rectangle([P(12, 17), P(16, 18)], fill=C["red"])
    elif n == 5:  # 坐姿神像：头饰 + 方脸 + 盘坐身体 + 红宝石眼
        d.rectangle([P(7, 3), P(21, 7)], fill=Gm)
        for x in (7, 12, 17):
            d.rectangle([P(x, 1), P(x + 3, 3)], fill=G)
        d.rectangle([P(8, 7), P(20, 15)], fill=G)
        d.rectangle([P(10, 10), P(12, 11)], fill=C["red"])
        d.rectangle([P(16, 10), P(18, 11)], fill=C["red"])
        d.rectangle([P(12, 13), P(16, 13)], fill=Gd)
        d.rectangle([P(6, 16), P(22, 22)], fill=G)
        d.rectangle([P(4, 22), P(24, 26)], fill=Gm)
        d.rectangle([P(11, 18), P(17, 19)], fill=tq)
        d.rectangle([P(3, 26), P(25, 27)], fill=Gd)
    img = bevel(img, 0.3, 0.3)
    return outline(img)


# ---------------- 卡面 ----------------

def card_base(body, body_l, body_d, frame, frame_l, gold_trim=False) -> Image.Image:
    """40×56 卡：1px 描边 + 1px 框（左上亮右下暗）+ 内底（上亮下暗的两段色）。四角 1px 透明。"""
    img = new(CARD_W, CARD_H)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, CARD_W - 1, CARD_H - 1], fill=INK)
    d.rectangle([1, 1, CARD_W - 2, CARD_H - 2], fill=frame)
    d.line([(1, 1), (CARD_W - 2, 1)], fill=frame_l)
    d.line([(1, 1), (1, CARD_H - 2)], fill=frame_l)
    d.rectangle([2, 2, CARD_W - 3, CARD_H - 3], fill=INK if gold_trim else body_d)
    d.rectangle([3, 3, CARD_W - 4, CARD_H - 4], fill=body)
    # 背景纹：底部 1/3 压暗一档（地面），顶部有一条亮边
    d.rectangle([3, CARD_H - 18, CARD_W - 4, CARD_H - 4], fill=body_d)
    d.line([(3, 3), (CARD_W - 4, 3)], fill=body_l)
    for c in [(0, 0), (CARD_W - 1, 0), (0, CARD_H - 1), (CARD_W - 1, CARD_H - 1)]:
        img.putpixel(c, CLEAR)
    return img


def name_band(img, s, color=None, band=None):
    """卡底名字条：12px 字，不加描边（加了会超宽），压在深色底条上。"""
    d = ImageDraw.Draw(img)
    band = band or INK
    d.rectangle([3, CARD_H - 15, CARD_W - 4, CARD_H - 4], fill=band)
    d.fontmode = "1"
    x0, y0, x1, y1 = d.textbbox((0, 0), s, font=FONT)
    w = x1 - x0
    d.text(((CARD_W - w) // 2 - x0, CARD_H - 15 + (12 - (y1 - y0)) // 2 - y0), s, font=FONT, fill=color or C["cream"])


def treasure_card(v: int) -> Image.Image:
    img = card_base(C["jungle"], C["jungle_l"], C["jungle_d"], C["slate"], C["slate_l"])
    # 大号数字（12px 字放大 2 倍）
    t = text_img(str(v), C["cream"], 2, INK, shadow=False)
    paste(img, t, (CARD_W - t.width) // 2, 3)
    # 宝石堆
    n = pile_count(v)
    top = 3 + t.height
    area_w, area_h = CARD_W - 8, CARD_H - 4 - top
    pile = None
    for gw in range(12 if n <= 3 else 9, 5, -1):
        cand = gem_pile(n, gw)
        if cand.width <= area_w and cand.height <= area_h:
            pile = cand
            break
    pile = pile or gem_pile(n, 6)
    paste(img, pile, (CARD_W - pile.width) // 2, top + (area_h - pile.height) // 2 + 1)
    return img


def hazard_card(kind: str, name: str) -> Image.Image:
    img = card_base(C["blood"], C["blood_l"], C["blood_d"], C["slate"], C["slate_l"])
    d = ImageDraw.Draw(img)
    # 危险标记：左上一个小三角警示
    icon = draw_hazard(kind, 30)
    paste(img, icon, (CARD_W - icon.width) // 2, 6)
    name_band(img, name, C["torch_l"])
    # 两侧红色锯齿条（同一类一眼认出「危险」）
    for y in range(4, CARD_H - 16, 4):
        d.point((3, y), fill=C["red"])
        d.point((CARD_W - 4, y + 2), fill=C["red"])
    return img


def artifact_card(n: int, name: str) -> Image.Image:
    img = card_base(C["relic"], C["relic_l"], darken(C["relic"], 0.3), C["gold_m"], C["gold_l"], gold_trim=True)
    d = ImageDraw.Draw(img)
    # 背光：金色放射纹
    cx, cy = CARD_W // 2, 21
    for i in range(16):
        a = i / 16 * math.tau
        for r in range(9, 17):
            x, y = round(cx + math.cos(a) * r), round(cy + math.sin(a) * r)
            if 3 <= x < CARD_W - 3 and 4 <= y < CARD_H - 16 and r % 2 == 0:
                d.point((x, y), fill=C["relic_l"])
    icon = draw_artifact(n, 30)
    paste(img, icon, (CARD_W - icon.width) // 2, 6)
    name_band(img, name, C["gold"])
    # 四角金钉
    for x, y in [(4, 4), (CARD_W - 5, 4)]:
        d.point((x, y), fill=C["gold_l"])
    return img


CHAKANA = [
    "....###....",
    "....###....",
    "..#######..",
    "..#######..",
    "###########",
    "###########",
    "###########",
    "..#######..",
    "..#######..",
    "....###....",
    "....###....",
]


def chakana(size: int, col, step=None) -> Image.Image:
    """印加十字（阶梯十字）：11×11 格的图案按 step 放大，中间挖一个方孔。"""
    s = step or max(1, size // 11)
    n = 11 * s
    img = new(n, n)
    d = ImageDraw.Draw(img)
    for y, row in enumerate(CHAKANA):
        for x, ch in enumerate(row):
            if ch == "#":
                d.rectangle([x * s, y * s, x * s + s - 1, y * s + s - 1], fill=col)
    h = max(1, s)
    c = n // 2
    d.rectangle([c - h, c - h, c + h - (0 if s % 2 else 1), c + h - (0 if s % 2 else 1)], fill=CLEAR)
    return img


def card_back() -> Image.Image:
    img = card_base(C["stone1"], C["stone2"], C["stone0"], C["slate"], C["slate_l"])
    d = ImageDraw.Draw(img)
    d.rectangle([3, 3, CARD_W - 4, CARD_H - 4], fill=C["stone1"])
    # 石块缝
    for y in (14, 28, 42):
        d.line([(3, y), (CARD_W - 4, y)], fill=C["stone0"])
    for i, y0 in enumerate((3, 15, 29, 43)):
        x = 13 if i % 2 else 25
        d.line([(x, y0), (x, min(CARD_H - 4, y0 + 10))], fill=C["stone0"])
    # 中间金色阶梯十字
    ch = chakana(22, C["gold_m"], 2)
    ch = bevel(outline(ch), 0.4, 0.3)
    paste(img, ch, (CARD_W - ch.width) // 2, (CARD_H - ch.height) // 2)
    d.rectangle([4, 4, CARD_W - 5, CARD_H - 5], outline=C["moss"])
    return img


def card_slot() -> Image.Image:
    """下一张牌的位置：虚线框 + 中间一个淡淡的问号形火光点。"""
    img = new(CARD_W, CARD_H)
    d = ImageDraw.Draw(img)
    col = rgb(PAL["torch"], 200)
    for x in range(1, CARD_W - 1, 4):
        d.line([(x, 1), (x + 1, 1)], fill=col)
        d.line([(x, CARD_H - 2), (x + 1, CARD_H - 2)], fill=col)
    for y in range(1, CARD_H - 1, 4):
        d.line([(1, y), (1, y + 1)], fill=col)
        d.line([(CARD_W - 2, y), (CARD_W - 2, y + 1)], fill=col)
    put_text(img, "?", CARD_W // 2, CARD_H // 2, rgb(PAL["torch"], 220), 2, None)
    return img


# ---------------- 玩家：帐篷、探险者、记号 ----------------

def mark(shape: str, col, size=10) -> Image.Image:
    img = new(size, size)
    d = ImageDraw.Draw(img)
    a, b = 1, size - 2
    m = size // 2
    if shape == "circle":
        d.ellipse([a, a, b, b], fill=col)
    elif shape == "triangle":
        d.polygon([(m - 0.5, a), (b, b), (a, b)], fill=col)
    elif shape == "square":
        d.rectangle([a + 1, a + 1, b - 1, b - 1], fill=col)
    elif shape == "diamond":
        d.polygon([(m - 0.5, a), (b, m - 0.5), (m - 0.5, b), (a, m - 0.5)], fill=col)
    elif shape == "star":
        pts = []
        for i in range(10):
            ang = -math.pi / 2 + i * math.pi / 5
            r = (b - a) / 2 + 0.6 if i % 2 == 0 else (b - a) / 4.2
            pts.append((m - 0.5 + math.cos(ang) * r, m - 0.3 + math.sin(ang) * r))
        d.polygon(pts, fill=col)
    elif shape == "plus":
        t = max(1, size // 5)
        d.rectangle([m - t, a, m + t - 1, b], fill=col)
        d.rectangle([a, m - t, b, m + t - 1], fill=col)
    elif shape == "moon":
        d.ellipse([a, a, b, b], fill=col)
        d.ellipse([a + size // 3, a - 1, b + size // 3, b - 2], fill=CLEAR)
    elif shape == "heart":
        rows = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."]
        ox, oy = (size - 7) // 2, (size - 6) // 2
        for yy, row in enumerate(rows):
            for xx, ch in enumerate(row):
                if ch == "#":
                    img.putpixel((ox + xx, oy + yy), col)
    return outline(img)


def tent(col_hex: str, shape: str, home: bool) -> Image.Image:
    """32×24 帐篷：玩家色帆布 A 字帐，门帘上是玩家记号。home=True：门帘掀开、里面亮着灯（已回营地）。"""
    W, H = 32, 24
    img = new(W, H)
    d = ImageDraw.Draw(img)
    col = rgb(col_hex)
    lt, dk = lighten(col, 0.25), darken(col, 0.38)
    # 地面影子
    d.rectangle([3, H - 3, W - 4, H - 2], fill=rgb("#000000", 90))
    # 帐篷主体（左亮右暗）
    poly(d, [(16, 3), (29, H - 3), (3, H - 3)], col)
    poly(d, [(16, 3), (29, H - 3), (20, H - 3)], dk)
    poly(d, [(16, 3), (9, H - 10), (7, H - 10)], lt)
    # 门
    if home:
        poly(d, [(16, 8), (21, H - 3), (11, H - 3)], C["torch"])
        poly(d, [(16, 11), (19, H - 3), (13, H - 3)], C["torch_l"])
        poly(d, [(16, 8), (11, H - 3), (9, H - 3)], dk)  # 掀开的门帘
        d.rectangle([22, H - 7, 24, H - 4], fill=C["torch_l"])  # 门口小灯
        d.point((23, H - 8), fill=C["ink"])
    else:
        poly(d, [(16, 8), (21, H - 3), (11, H - 3)], dk)
        d.line([(16, 8), (16, H - 3)], fill=darken(col, 0.6))
    # 杆子和小旗
    d.line([(16, 0), (16, 3)], fill=C["wood_d"])
    d.rectangle([17, 0, 20, 2], fill=col)
    img = outline(img)
    # 记号（关门时在门帘上；开门时在帐篷左坡上）
    mk = mark(shape, col if home else lt, 9)
    if home:
        paste(img, mark(shape, lt, 9), 5, H - 12)
    else:
        paste(img, mk, 12, H - 13)
    return img


def explorer(col_hex: str) -> Image.Image:
    """16×24 探险者：宽檐帽、玩家色上衣、卡其裤、手举火把。用作牌桌上的棋子和头像。"""
    img = new(16, 24)
    d = ImageDraw.Draw(img)
    col = rgb(col_hex)
    # 火把（右手）
    d.line([(12, 9), (12, 14)], fill=C["wood"])
    f = flame(5, 7, 0.5)
    paste(img, f, 10, 2)
    # 帽子
    d.rectangle([3, 4, 10, 4], fill=C["wood_d"])
    d.rectangle([5, 1, 8, 3], fill=C["wood"])
    d.line([(5, 3), (8, 3)], fill=C["wood_d"])
    # 脸
    d.rectangle([5, 5, 8, 8], fill=C["skin"])
    d.point((7, 6), fill=C["ink"])
    d.line([(5, 8), (8, 8)], fill=C["skin_d"])
    # 身体（玩家色）
    d.rectangle([4, 9, 9, 15], fill=col)
    d.line([(9, 9), (9, 15)], fill=darken(col, 0.35))
    d.rectangle([10, 10, 11, 12], fill=col)  # 举火把的手臂
    d.point((11, 13), fill=C["skin"])
    d.rectangle([3, 10, 3, 14], fill=col)
    d.point((3, 15), fill=C["skin"])
    d.line([(4, 13), (9, 13)], fill=C["wood_d"])  # 腰带
    # 裤子和靴子
    d.rectangle([4, 16, 9, 19], fill=C["sand_d"])
    d.line([(6, 18), (7, 18)], fill=CLEAR)
    d.rectangle([4, 20, 5, 21], fill=C["wood_d"])
    d.rectangle([8, 20, 9, 21], fill=C["wood_d"])
    d.line([(6, 17), (7, 17)], fill=darken(C["sand_d"], 0.3))
    img = outline(img)
    return img


# ---------------- 选择：火把（继续）/ 营地（离开） ----------------

def choice_torch(S=32) -> Image.Image:
    """继续：一支大火把，火苗占上半。"""
    img = new(S, S)
    d = ImageDraw.Draw(img)
    cx = S // 2
    for y in range(15, S - 1):
        d.rectangle([cx - 2, y, cx + 1, y], fill=C["wood"])
        d.point((cx + 1, y), fill=C["wood_d"])
    d.rectangle([cx - 4, 13, cx + 3, 17], fill=C["wood_d"])
    d.line([(cx - 4, 13), (cx + 3, 13)], fill=C["bone_d"])
    d.line([(cx - 4, 15), (cx + 3, 15)], fill=C["bone_d"])
    f = flame(18, 16, 0.4)
    paste(img, f, cx - 9, 0)
    return outline(img)


def choice_camp(S=32) -> Image.Image:
    img = new(S, S)
    d = ImageDraw.Draw(img)
    # 帆布帐篷（中性米色）+ 门口篝火
    poly(d, [(12, 5), (23, 27), (1, 27)], C["sand"])
    poly(d, [(12, 5), (23, 27), (16, 27)], C["sand_d"])
    poly(d, [(12, 12), (16, 27), (8, 27)], C["wood_d"])
    d.line([(13, 2), (13, 5)], fill=C["wood_d"])
    d.rectangle([14, 2, 17, 4], fill=C["red"])
    # 篝火
    d.line([(21, 28), (29, 25)], fill=C["wood"], width=2)
    d.line([(21, 25), (29, 28)], fill=C["wood"], width=2)
    f = flame(9, 12, 1.2)
    paste(img, f, 21, 14)
    img = bevel(img, 0.2, 0.2)
    return outline(img)


def choice_card(kind: str) -> Image.Image:
    """24×32 选择小卡：亮拳时每人头顶翻开的那张。torch 绿底火把、camp 沙色底帐篷、back 石纹背面（已决定未亮出）。"""
    W, H = 24, 32
    img = new(W, H)
    d = ImageDraw.Draw(img)
    if kind == "torch":
        body, frame = C["jungle"], C["torch"]
    elif kind == "camp":
        body, frame = rgb("#6a4a2a"), C["sand"]
    else:
        body, frame = C["stone1"], C["slate_l"]
    d.rectangle([0, 0, W - 1, H - 1], fill=INK)
    d.rectangle([1, 1, W - 2, H - 2], fill=frame)
    d.rectangle([2, 2, W - 3, H - 3], fill=body)
    for c in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]:
        img.putpixel(c, CLEAR)
    if kind == "torch":
        t = torch_stick(14, 26, 0.4)
        paste(img, t, (W - t.width) // 2, 3)
    elif kind == "camp":
        ic = choice_camp(32).resize((24, 24), Image.NEAREST)
        # 缩小会坏像素，改成直接画一个小帐篷
        ic = new(20, 20)
        dd = ImageDraw.Draw(ic)
        poly(dd, [(10, 2), (19, 18), (1, 18)], C["sand"])
        poly(dd, [(10, 2), (19, 18), (13, 18)], C["sand_d"])
        poly(dd, [(10, 8), (13, 18), (7, 18)], C["wood_d"])
        ic = outline(ic)
        paste(img, ic, 2, 6)
    else:
        ch = bevel(outline(chakana(11, C["gold_m"], 1)), 0.4, 0.3)
        paste(img, ch, (W - ch.width) // 2, (H - ch.height) // 2)
    return img


# ---------------- 图标 16×16 ----------------

def icon_canvas():
    return new(16, 16)


def center(src: Image.Image, W=16, H=16) -> Image.Image:
    img = new(W, H)
    paste(img, src, (W - src.width) // 2, (H - src.height) // 2)
    return img


def icon_gem():
    return center(gem(12))


def icon_artifact():
    return center(draw_artifact(5, 15))


def icon_deck():
    img = icon_canvas()
    d = ImageDraw.Draw(img)
    for k in (2, 1, 0):
        x, y = 3 + k, 1 + k
        d.rectangle([x, y, x + 8, y + 11], fill=INK)
        d.rectangle([x + 1, y + 1, x + 7, y + 10], fill=C["slate_l"] if k == 0 else C["slate"])
        d.rectangle([x + 2, y + 2, x + 6, y + 9], fill=C["stone2"] if k == 0 else C["stone1"])
    d.rectangle([5, 5, 7, 8], fill=C["gold"])
    return img


def icon_tent():
    img = icon_canvas()
    d = ImageDraw.Draw(img)
    poly(d, [(7, 2), (14, 13), (1, 13)], C["sand"])
    poly(d, [(7, 2), (14, 13), (10, 13)], C["sand_d"])
    poly(d, [(7, 6), (10, 13), (4, 13)], C["wood_d"])
    return outline(img)


def icon_torch():
    return center(torch_stick(10, 15, 0.4, outlined=True))


def icon_camp():
    img = icon_canvas()
    d = ImageDraw.Draw(img)
    poly(d, [(6, 2), (12, 12), (0, 12)], C["sand"])
    poly(d, [(6, 2), (12, 12), (8, 12)], C["sand_d"])
    poly(d, [(6, 6), (8, 12), (4, 12)], C["wood_d"])
    f = flame(4, 7, 1.0)
    paste(img, f, 11, 5)
    d.line([(11, 13), (15, 12)], fill=C["wood"])
    return outline(img)


def icon_skull():
    img = icon_canvas()
    d = ImageDraw.Draw(img)
    d.ellipse([2, 1, 13, 11], fill=C["bone"])
    d.rectangle([4, 9, 11, 13], fill=C["bone"])
    d.rectangle([4, 5, 6, 7], fill=INK)
    d.rectangle([9, 5, 11, 7], fill=INK)
    d.point((7, 9), fill=INK)
    d.point((8, 9), fill=INK)
    for x in (5, 7, 9):
        d.line([(x, 12), (x, 13)], fill=C["bone_d"])
    return outline(bevel(img, 0.2, 0.3))


def icon_wait():
    img = icon_canvas()
    d = ImageDraw.Draw(img)
    d.rectangle([3, 1, 12, 2], fill=C["wood"])
    d.rectangle([3, 13, 12, 14], fill=C["wood"])
    poly(d, [(4, 3), (11, 3), (8, 8), (7, 8)], C["bone"])
    poly(d, [(7, 8), (8, 8), (11, 12), (4, 12)], C["bone"])
    poly(d, [(6, 5), (9, 5), (8, 7), (7, 7)], C["sand"])
    poly(d, [(5, 12), (10, 12), (8, 10), (7, 10)], C["sand"])
    return outline(img)


def icon_hidden():
    """已经决定、还没亮出：一张扣着的小选择卡。"""
    img = icon_canvas()
    d = ImageDraw.Draw(img)
    d.rectangle([3, 1, 12, 14], fill=C["slate_l"])
    d.rectangle([4, 2, 11, 13], fill=C["stone1"])
    d.rectangle([6, 6, 9, 9], fill=C["gold_m"])
    d.rectangle([7, 5, 8, 10], fill=C["gold_m"])
    d.rectangle([5, 7, 10, 8], fill=C["gold_m"])
    return outline(img)


def icon_crown():
    img = icon_canvas()
    d = ImageDraw.Draw(img)
    poly(d, [(1, 5), (4, 9), (7, 3), (8, 3), (11, 9), (14, 5), (13, 12), (2, 12)], C["gold"])
    d.rectangle([2, 11, 13, 13], fill=C["gold_m"])
    d.point((7, 11), fill=C["red"])
    d.point((4, 12), fill=C["gem"])
    d.point((11, 12), fill=C["gem"])
    return outline(bevel(img, 0.3, 0.2))


def icon_temple():
    """阶梯神庙：局数指示（5 个，打完的变暗由 CSS 做）。"""
    img = icon_canvas()
    d = ImageDraw.Draw(img)
    for k, (x0, x1) in enumerate([(1, 14), (3, 12), (5, 10)]):
        y1 = 14 - k * 4
        d.rectangle([x0, y1 - 3, x1, y1], fill=C["rock_l"] if k % 2 == 0 else C["rock"])
    d.rectangle([6, 1, 9, 2], fill=C["rock"])
    d.rectangle([7, 11, 8, 14], fill=INK)
    return outline(bevel(img, 0.25, 0.3))


def icon_hazard(kind):
    return center(draw_hazard(kind, 14))


# ---------------- 场景背景 512×288 ----------------

def scene(day: bool) -> Image.Image:
    W, H = 512, 288
    rnd = random.Random(7)
    if day:
        base = [rgb("#8d8a70"), rgb("#a09c80"), rgb("#7c7a62"), rgb("#b2ad8e")]
        mortar = rgb("#4e4c3c")
        floor = [rgb("#b8a682"), rgb("#a8966e")]
        door_col = rgb("#1a1814")
        vine = (C["dayleaf"], C["dayleaf_d"])
    else:
        base = [rgb("#16272a"), rgb("#1b302c"), rgb("#122226"), rgb("#203630")]
        mortar = rgb("#070e10")
        floor = [rgb("#1c2a26"), rgb("#16221f")]
        door_col = rgb("#020406")
        vine = (rgb("#2f5a2c"), rgb("#1b3a1c"))
    img = new(W, H, base[0])
    d = ImageDraw.Draw(img)
    wall_h = 222
    # 印加多边形石墙：一行行不规则石块，砖缝 1px，左上亮边
    y = 0
    row = 0
    while y < wall_h:
        rh = rnd.choice([18, 20, 22, 24, 26])
        x = -rnd.randint(0, 30)
        while x < W:
            bw = rnd.randint(26, 58)
            col = rnd.choice(base)
            # 石块四角稍微切掉（多边形感）
            cut = rnd.randint(2, 5)
            pts = [(x + cut, y), (x + bw - cut, y), (x + bw, y + cut), (x + bw, y + rh - cut), (x + bw - cut, y + rh),
                   (x + cut, y + rh), (x, y + rh - cut), (x, y + cut)]
            d.polygon(pts, fill=col, outline=mortar)
            d.line([(x + cut + 1, y + 1), (x + bw - cut - 1, y + 1)], fill=lighten(col, 0.12))
            d.line([(x + 1, y + cut + 1), (x + 1, y + rh - cut - 1)], fill=lighten(col, 0.08))
            # 点状纹理
            for _ in range(bw * rh // 90):
                px, py = x + rnd.randint(3, bw - 3), y + rnd.randint(3, rh - 3)
                d.point((px, py), fill=darken(col, 0.18))
            x += bw
        y += rh
        row += 1
    # 地面石板
    d.rectangle([0, wall_h, W, H], fill=floor[0])
    for yy, step in [(wall_h, 64), (wall_h + 20, 72), (wall_h + 42, 80)]:
        d.line([(0, yy), (W, yy)], fill=mortar)
        off = rnd.randint(0, step)
        for xx in range(-off, W, step):
            d.line([(xx, yy), (xx, min(H, yy + 22))], fill=mortar)
    # 印加梯形门洞（中间偏上），里面越深越黑
    cx = W // 2
    top_w, bot_w, dt, db = 64, 92, 70, wall_h
    d.polygon([(cx - bot_w // 2 - 6, db), (cx - top_w // 2 - 6, dt - 6), (cx + top_w // 2 + 6, dt - 6),
               (cx + bot_w // 2 + 6, db)], fill=lighten(base[1], 0.1), outline=mortar)
    for k in range(6):
        t = k / 6
        tw = top_w - k * 6
        bw_ = bot_w - k * 8
        col = mix(darken(base[0], 0.55), door_col, t)
        d.polygon([(cx - bw_ // 2, db), (cx - tw // 2, dt + k * 4), (cx + tw // 2, dt + k * 4), (cx + bw_ // 2, db)], fill=col)
    # 门楣大石
    d.rectangle([cx - top_w // 2 - 14, dt - 18, cx + top_w // 2 + 14, dt - 6], fill=base[3], outline=mortar)
    d.line([(cx - top_w // 2 - 13, dt - 17), (cx + top_w // 2 + 13, dt - 17)], fill=lighten(base[3], 0.15))
    # 两侧壁龛（梯形小龛，印加特色）
    for nx in (cx - 150, cx + 150, cx - 230, cx + 230):
        d.polygon([(nx - 14, 160), (nx - 10, 120), (nx + 10, 120), (nx + 14, 160)], fill=darken(base[0], 0.5), outline=mortar)
    # 火把光晕（同心带，抖动）+ 火把
    torches = [(cx - 100, 112), (cx + 100, 112), (cx - 200, 104), (cx + 200, 104)]
    glow = new(W, H)
    gd = ImageDraw.Draw(glow)
    for tx, ty in torches:
        for r, a in [(70, 18), (50, 26), (34, 34), (20, 44)]:
            if day:
                a = a // 2
            gd.ellipse([tx - r, ty - r, tx + r, ty + r], fill=rgb(PAL["torch"], a))
    # 抖动：随机挖掉一些光点，保持像素感
    gp = glow.load()
    for yy in range(H):
        for xx in range(W):
            if gp[xx, yy][3] and (xx + yy) % 2 == 0 and gp[xx, yy][3] < 30:
                gp[xx, yy] = CLEAR
    img.alpha_composite(glow)
    for tx, ty in torches:
        t = torch_stick(16, 32, (tx % 7) / 2)
        paste(img, t, tx - 8, ty - 12)
        d.rectangle([tx - 3, ty + 14, tx + 3, ty + 16], fill=C["rock_d"])  # 托架
    # 藤蔓从顶上垂下
    for vx in rnd.sample(range(10, W - 10, 18), 14):
        L = rnd.randint(30, 110)
        ph = rnd.random() * 6
        for yy in range(0, L):
            xx = vx + round(math.sin(yy / 9 + ph) * 3)
            d.point((xx, yy), fill=vine[1])
            if yy % 7 == 3:
                d.rectangle([xx - 2, yy, xx, yy + 1], fill=vine[0])
            if yy % 7 == 6:
                d.rectangle([xx + 1, yy, xx + 3, yy + 1], fill=vine[0])
    if day:
        # 白天：左上斜射的光柱
        shaft = new(W, H)
        sd = ImageDraw.Draw(shaft)
        for k, x0 in enumerate((40, 120, 330)):
            sd.polygon([(x0, 0), (x0 + 40, 0), (x0 + 160, H), (x0 + 110, H)], fill=rgb("#fff4c8", 34 - k * 6))
        img.alpha_composite(shaft)
    else:
        # 夜间：地上散落的发光宝石点
        for _ in range(26):
            gx, gy = rnd.randint(20, W - 20), rnd.randint(wall_h + 6, H - 6)
            d.point((gx, gy), fill=C["gem"])
            d.point((gx + 1, gy), fill=C["gem_m"])
        # 四周暗角
        vg = new(W, H)
        vp = vg.load()
        for yy in range(H):
            for xx in range(W):
                dx, dy = (xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)
                r = math.sqrt(dx * dx * 0.8 + dy * dy)
                a = max(0, min(150, int((r - 0.75) * 300)))
                if a and (xx + yy) % 2 == 0 or a > 90:
                    vp[xx, yy] = (2, 6, 8, a)
        img.alpha_composite(vg)
    return img.convert("RGBA")


def floor_tile(day: bool) -> Image.Image:
    """32×32 可平铺的石板地面：放在路径（翻出的牌）底下。"""
    if day:
        a, b, m = rgb("#c9b78e"), rgb("#bba97f"), rgb("#8e7c58")
    else:
        a, b, m = rgb("#1a2a26"), rgb("#16241f"), rgb("#0a1412")
    img = new(32, 32, a)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 16, 31, 31], fill=b)
    d.line([(0, 15), (31, 15)], fill=m)
    d.line([(0, 31), (31, 31)], fill=m)
    d.line([(10, 0), (10, 15)], fill=m)
    d.line([(26, 16), (26, 31)], fill=m)
    d.line([(1, 0), (9, 0)], fill=lighten(a, 0.08))
    d.line([(11, 0), (31, 0)], fill=lighten(a, 0.08))
    d.line([(0, 16), (25, 16)], fill=lighten(b, 0.08))
    rnd = random.Random(3 if day else 4)
    for _ in range(18):
        x, y = rnd.randint(1, 30), rnd.randint(1, 30)
        if img.getpixel((x, y))[:3] != m[:3]:
            d.point((x, y), fill=darken(img.getpixel((x, y)), 0.15))
    return img


# ---------------- 动画 ----------------

def fx_torch() -> Image.Image:
    return strip([torch_stick(16, 32, i / 6 * math.tau) for i in range(6)])


def fx_gem_spin() -> Image.Image:
    frames = []
    base = gem(12)
    for w in (12, 9, 6, 4, 6, 9):
        f = new(16, 16)
        g = base.crop((1, 0, 13, base.height)).resize((w, base.height), Image.NEAREST)
        g2 = new(w + 2, base.height)
        paste(g2, g, 1, 0)
        g2 = outline(g2)
        paste(f, g2, (16 - g2.width) // 2, (16 - g2.height) // 2)
        frames.append(f)
    return strip(frames)


def star(d, cx, cy, r, col, core):
    d.line([(cx - r, cy), (cx + r, cy)], fill=col)
    d.line([(cx, cy - r), (cx, cy + r)], fill=col)
    if r >= 3:
        d.line([(cx - 1, cy - 1), (cx + 1, cy + 1)], fill=col)
        d.line([(cx - 1, cy + 1), (cx + 1, cy - 1)], fill=col)
    d.point((cx, cy), fill=core)


def fx_sparkle() -> Image.Image:
    frames = []
    pts = [(16, 16, 1.0), (7, 9, 0.6), (25, 8, 0.7), (8, 24, 0.5), (25, 25, 0.6)]
    for i in range(6):
        f = new(32, 32)
        d = ImageDraw.Draw(f)
        for k, (x, y, s) in enumerate(pts):
            ph = i - k * 0.6
            if ph < 0:
                continue
            r = round([1, 3, 5, 4, 2, 1][min(5, int(ph))] * s) if k else [2, 4, 7, 6, 3, 1][i]
            if r <= 0:
                continue
            star(d, x, y, r, C["gold"] if k % 2 else C["gem_l"], C["gold_l"])
        frames.append(f)
    return strip(frames)


def fx_collapse() -> Image.Image:
    """64×64 × 10：石块从上砸下（0–4 帧）、落地扬起烟尘（3–8 帧）、烟尘散开（9 帧几乎透明）。"""
    rnd = random.Random(11)
    rocks = [(rnd.randint(6, 58), -rnd.randint(2, 34), rnd.randint(3, 7), rnd.choice(["rock", "rock_l", "rock_d"])) for _ in range(10)]
    puffs = [(rnd.uniform(-1, 1), rnd.uniform(0.3, 1.0), rnd.randint(4, 8)) for _ in range(16)]
    frames = []
    for i in range(10):
        f = new(64, 64)
        d = ImageDraw.Draw(f)
        for x, y0, r, col in rocks:
            y = y0 + i * 14
            landed = y >= 60 - r
            y = min(y, 60 - r)
            if i >= 8 or (landed and i >= 7):
                continue
            pts = [(x + math.cos(a / 7 * math.tau + x) * r * (0.85 + 0.15 * (a % 2)), y + math.sin(a / 7 * math.tau + x) * r * 0.85) for a in range(7)]
            d.polygon(pts, fill=C[col])
            d.point((round(x - r / 3), round(y - r / 3)), fill=C["rock_l"] if col != "rock_l" else C["bone"])
        f = outline(f)
        if i >= 3:
            k = i - 3  # 0..6
            dust = new(64, 64)
            dd = ImageDraw.Draw(dust)
            a_ = max(0, 230 - k * 34)
            for dx, up, r in puffs:
                cx = 32 + dx * (8 + k * 4.5)
                cy = 60 - up * (2 + k * 3.2)
                rr = r + k // 2
                col = (196, 186, 160, a_) if r % 2 else (150, 140, 120, a_)
                dd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col)
            # 抖动挖洞，越往后越稀
            dp = dust.load()
            for yy in range(64):
                for xx in range(64):
                    if dp[xx, yy][3] and ((xx * 73856093 ^ yy * 19349663 ^ 83492791) % 7) < k:
                        dp[xx, yy] = CLEAR
            f.alpha_composite(dust)
        frames.append(f)
    return strip(frames)


def fx_crack() -> Image.Image:
    """40×56 × 5：裂纹从中间向四周裂开，叠在两张同种危险卡上。"""
    rnd = random.Random(5)
    branches = []
    for a in (0.3, 1.4, 2.4, 3.4, 4.6, 5.6):
        x, y = 20.0, 26.0
        path = [(x, y)]
        for s in range(8):
            a += rnd.uniform(-0.5, 0.5)
            x += math.cos(a) * 3.2
            y += math.sin(a) * 3.2
            path.append((x, y))
        branches.append(path)
    frames = []
    for i in range(5):
        f = new(CARD_W, CARD_H)
        d = ImageDraw.Draw(f)
        n = [0, 2, 4, 6, 8][i]
        for path in branches:
            seg = path[: n + 1]
            if len(seg) >= 2:
                d.line([(round(x), round(y)) for x, y in seg], fill=INK, width=1)
                d.line([(round(x) + 1, round(y)) for x, y in seg], fill=rgb(PAL["torch"], 200), width=1)
        if i >= 3:
            d.rectangle([0, 0, CARD_W - 1, CARD_H - 1], outline=C["red"])
            d.rectangle([1, 1, CARD_W - 2, CARD_H - 2], outline=rgb(PAL["red"], 140))
        frames.append(f)
    return strip(frames)


# ---------------- 结算装饰 ----------------

def ui_banner() -> Image.Image:
    W, H = 160, 32
    img = new(W, H)
    d = ImageDraw.Draw(img)
    # 两头燕尾
    for side in (0, 1):
        x0 = 0 if side == 0 else W - 22
        pts = [(x0, 8), (x0 + 22, 8), (x0 + 22, 28), (x0, 28), (x0 + 7, 18)] if side == 0 else \
              [(x0, 8), (x0 + 22, 8), (x0 + 15, 18), (x0 + 22, 28), (x0, 28)]
        d.polygon(pts, fill=C["blood_l"])
    d.rectangle([14, 3, W - 15, 25], fill=C["stone2"])
    d.rectangle([14, 3, W - 15, 4], fill=C["gold"])
    d.rectangle([14, 24, W - 15, 25], fill=C["gold_m"])
    # 阶梯回纹
    for x in range(18, W - 18, 8):
        d.rectangle([x, 6, x + 2, 7], fill=C["gold_d"])
        d.rectangle([x + 4, 21, x + 6, 22], fill=C["gold_d"])
    img = bevel(img, 0.2, 0.2)
    return outline(img)


def ui_chest() -> Image.Image:
    W, H = 64, 48
    img = new(W, H)
    d = ImageDraw.Draw(img)
    # 开着的盖子（向后翻起，接在箱身上沿）
    d.rectangle([10, 6, 54, 24], fill=C["wood_d"])
    d.rectangle([10, 6, 54, 8], fill=C["gold_m"])
    d.rectangle([30, 6, 34, 24], fill=C["gold_m"])
    d.rectangle([13, 11, 51, 24], fill=darken(C["wood_d"], 0.4))
    # 箱身
    d.rectangle([8, 24, 56, 44], fill=C["wood"])
    d.rectangle([8, 24, 56, 27], fill=C["gold_m"])
    d.rectangle([8, 41, 56, 44], fill=C["gold_d"])
    d.rectangle([29, 28, 35, 36], fill=C["gold"])
    d.point((32, 32), fill=INK)
    for x in (16, 48):
        d.rectangle([x - 1, 27, x + 1, 41], fill=C["wood_d"])
    # 宝石堆冒出来
    pile = gem_pile(10, 9)
    paste(img, pile, (W - pile.width) // 2, 25 - pile.height + 8)
    # 金块和神器
    a = draw_artifact(1, 14)
    paste(img, a, 44, 12)
    img = bevel(img, 0.2, 0.25)
    return outline(img)


def ui_divider() -> Image.Image:
    W, H = 96, 8
    img = new(W, H)
    d = ImageDraw.Draw(img)
    d.line([(0, 4), (W - 1, 4)], fill=C["gold_m"])
    for x in range(4, W - 4, 12):
        d.rectangle([x, 2, x + 3, 5], fill=C["gold"])
        d.rectangle([x + 1, 1, x + 2, 6], fill=C["gold"])
    d.rectangle([W // 2 - 3, 1, W // 2 + 2, 6], fill=C["gem"])
    return outline(img)


def ui_badge(v: int) -> Image.Image:
    """神器分值徽章 20×20：5 分黑曜石、10 分金（实体版的计分标记）。数字代码画。"""
    S = 20
    img = new(S, S)
    d = ImageDraw.Draw(img)
    if v == 5:
        body, rim, txt = rgb("#2a2238"), rgb("#6a5a84"), C["gold"]
    else:
        body, rim, txt = C["gold"], C["gold_d"], INK
    d.ellipse([0, 0, S - 1, S - 1], fill=INK)
    d.ellipse([1, 1, S - 2, S - 2], fill=rim)
    d.ellipse([2, 2, S - 3, S - 3], fill=body)
    d.arc([3, 3, S - 4, S - 4], 190, 260, fill=lighten(body, 0.35))
    s = str(v)
    dd = ImageDraw.Draw(img)
    dd.fontmode = "1"
    x0, y0, x1, y1 = dd.textbbox((0, 0), s, font=FONT)
    dd.text(((S - (x1 - x0)) // 2 - x0, (S - (y1 - y0)) // 2 - y0), s, font=FONT, fill=txt)
    return img


# ---------------- 汇总 ----------------

def build_all() -> None:
    for v in TREASURES:
        save(treasure_card(v), f"cards/treasure-{v}.png")
    for k, name in HAZARDS:
        save(hazard_card(k, name), f"cards/hazard-{k}.png")
    for n, name in ARTIFACTS:
        save(artifact_card(n, name), f"cards/artifact-{n}.png")
    save(card_back(), "cards/back.png")
    save(card_slot(), "cards/slot.png")

    for i, (cid, hx, shape, _) in enumerate(PLAYERS):
        save(tent(hx, shape, False), f"players/tent-{cid}.png")
        save(tent(hx, shape, True), f"players/tent-{cid}-home.png")
        save(explorer(hx), f"players/explorer-{cid}.png")
        save(mark(shape, rgb(hx), 10), f"players/mark-{cid}.png")

    save(choice_torch(), "choice/torch.png")
    save(choice_camp(), "choice/camp.png")
    for k in ("torch", "camp", "back"):
        save(choice_card(k), f"choice/card-{k}.png")

    icons = {
        "gem": icon_gem(), "artifact": icon_artifact(), "deck": icon_deck(), "tent": icon_tent(),
        "torch": icon_torch(), "camp": icon_camp(), "skull": icon_skull(), "wait": icon_wait(),
        "hidden": icon_hidden(), "crown": icon_crown(), "temple": icon_temple(),
    }
    for k, _ in HAZARDS:
        icons[f"hazard-{k}"] = icon_hazard(k)
    for k, im in icons.items():
        save(im, f"icons/{k}.png")

    save(scene(False), "scene/night.png")
    save(scene(True), "scene/day.png")
    save(floor_tile(False), "table/floor-night.png")
    save(floor_tile(True), "table/floor-day.png")

    save(fx_torch(), "fx/torch.png")
    save(fx_gem_spin(), "fx/gem-spin.png")
    save(fx_sparkle(), "fx/sparkle.png")
    save(fx_collapse(), "fx/collapse.png")
    save(fx_crack(), "fx/crack.png")

    save(ui_banner(), "ui/banner.png")
    save(ui_chest(), "ui/chest.png")
    save(ui_divider(), "ui/divider.png")
    save(ui_badge(5), "ui/badge-5.png")
    save(ui_badge(10), "ui/badge-10.png")
    print(f"写了 {len(WRITTEN)} 个文件到 {OUT}")


def check() -> int:
    """spec.md 里每个 `xxx.png`（带尺寸）都要在 public/art 里、尺寸一致；public/art 里不能有 spec 没列的文件。"""
    text = SPEC.read_text(encoding="utf-8")
    want: dict[str, tuple[int, int]] = {}
    for line in text.splitlines():
        m = re.match(r"\|\s*`([^`]+\.png)`\s*\|\s*(\d+)×(\d+)", line)
        if m:
            name, w, h = m.group(1), int(m.group(2)), int(m.group(3))
            # 支持 {red,blue,…} 和 {1..5} 这种展开写法
            names = expand(name)
            for nm in names:
                want[nm] = (w, h)
    have = {str(p.relative_to(OUT)) for p in OUT.rglob("*.png")}
    bad = 0
    for nm, (w, h) in sorted(want.items()):
        p = OUT / nm
        if not p.exists():
            print("缺文件", nm)
            bad += 1
            continue
        sz = Image.open(p).size
        if sz != (w, h):
            print("尺寸不对", nm, sz, "spec", (w, h))
            bad += 1
    for nm in sorted(have - set(want)):
        print("spec 没列", nm)
        bad += 1
    print(f"spec 列了 {len(want)} 个文件，public/art 有 {len(have)} 个，问题 {bad} 个")
    return bad


def expand(name: str) -> list[str]:
    m = re.search(r"\{([^}]+)\}", name)
    if not m:
        return [name]
    out = []
    for part in m.group(1).split(","):
        out += expand(name[: m.start()] + part + name[m.end():])
    return out


def colors() -> None:
    import itertools

    import numpy as np

    M = {
        "deutan": np.array([[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]),
        "protan": np.array([[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]]),
        "tritan": np.array([[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]),
        "normal": np.eye(3),
    }

    def lin(c):
        v = np.array(rgb(c)[:3]) / 255
        return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)

    def lab(lv):
        lv = np.clip(lv, 0, 1)
        X = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]) @ lv
        X = X / np.array([0.9505, 1, 1.089])
        f = np.where(X > 0.008856, np.cbrt(X), 7.787 * X + 16 / 116)
        return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])

    for k, m in M.items():
        L = {p[0]: lab(m @ lin(p[1])) for p in PLAYERS}
        d, a, b = min((float(np.linalg.norm(L[a] - L[b])), a, b) for a, b in itertools.combinations(L, 2))
        print(f"{k}: 最近的一对 {a}-{b} 色差 {d:.0f}")


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(1 if check() else 0)
    if "--colors" in sys.argv:
        colors()
        sys.exit(0)
    build_all()
