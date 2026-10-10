"""印加宝藏 美术画廊（不阻塞的拍板）：每样素材一题，选项是候选按实际用途合成后的大图（推荐 = 我挑定的那张）。
图片写到 art/out/gallery/，JSON 写到 ~/projects/pipeline/games/incan/assets/gallery-decision.json（制作人发布）。
用法：~/miniconda3/envs/quant/bin/python art/gallery.py
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import final as F  # noqa: E402
import simple as S  # noqa: E402

ART = Path(__file__).resolve().parent
OUT = ART / "out" / "gallery"
OUT.mkdir(parents=True, exist_ok=True)
DEC = Path.home() / "projects/pipeline/games/incan/assets/gallery-decision.json"
BASE = copy.deepcopy(F.SEL)
NIGHT = (14, 26, 28, 255)
DAY = (244, 240, 228, 255)


def v2path(c: str) -> str:
    folder, n = c.split("#")
    n = int(n)
    return f"out/r1/v2/{folder}/{folder}.png" if n == 0 else f"out/r1/v2/{folder}/{folder}-{n}.png"


def board(img: Image.Image, scale: int, both=True, pad=12) -> Image.Image:
    """放大 scale 倍，上夜下日两条底；右边再放一个 1× 原大。"""
    big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    w = big.width + img.width + pad * 3
    rows = (NIGHT, DAY) if both else (NIGHT,)
    h = (big.height + pad) * len(rows) + pad
    out = Image.new("RGBA", (w, h), (30, 30, 30, 255))
    for i, bg in enumerate(rows):
        y = pad + i * (big.height + pad)
        out.alpha_composite(Image.new("RGBA", (w - 2 * pad, big.height), bg), (pad, y))
        out.alpha_composite(big, (pad, y))
        out.alpha_composite(img, (pad * 2 + big.width, y))
    return out


def save(img: Image.Image, name: str) -> str:
    p = OUT / f"{name}.png"
    img.convert("RGB").save(p)
    return str(p)


def with_sel(key: str, src: str, fn):
    F.SEL.clear()
    F.SEL.update(copy.deepcopy(BASE))
    F.SEL[key] = dict(F.SEL.get(key, {}), src=src)
    try:
        return fn()
    finally:
        F.SEL.clear()
        F.SEL.update(copy.deepcopy(BASE))


def cands(key):
    s = BASE[key]
    return [s["cand"]] + s.get("alts", [])


questions = []


def q(qid, title, help_, opts):
    questions.append({"id": qid, "type": "choice", "question": title, "help": help_, "options": opts, "allowOther": True})


def opt(value, label, img_path, desc, rec):
    o = {"value": value, "label": label, "images": [img_path], "description": desc}
    if rec:
        o["recommended"] = True
    return o


# 场景
for t, name in (("night", "夜间"), ("day", "白天")):
    opts = []
    for i, c in enumerate(cands(f"scene-{t}")):
        img = Image.open(ART / f"out/r1/scenes/{c}.png").convert("RGBA")
        p = save(img.resize((1024, 576), Image.NEAREST), f"scene-{t}-{c}")
        opts.append(opt(c, f"{name}场景 {c.split('-s')[-1]}", p, BASE[f"scene-{t}"]["why"] if i == 0 else "备选", i == 0))
    q(f"scene-{t}", f"{name}背景（scene/{t}.png，512×288，铺满 3×/4×，上面压半透明遮罩）", "", opts)

# 宝物卡（四档宝石堆一套）
sets = []
tiers = ["gems-1", "gems-s", "gems-m", "gems-l"]
for k in range(3):
    def mk(k=k):
        F.SEL.clear()
        F.SEL.update(copy.deepcopy(BASE))
        for t in tiers:
            c = cands(t)[min(k, len(cands(t)) - 1)]
            F.SEL[t] = dict(F.SEL[t], src=v2path(c))
        img = S.strip([F.treasure(v) for v in S.TREASURES])
        F.SEL.clear()
        F.SEL.update(copy.deepcopy(BASE))
        return img
    label = " / ".join(cands(t)[min(k, len(cands(t)) - 1)] for t in tiers)
    sets.append(opt(f"set{k}", f"宝石堆第 {k + 1} 套", save(board(mk(), 3), f"treasure-set{k}"),
                    ("四档：1 一颗、2–4 两三颗、5–9 一小簇、11–17 一大堆；宝石加深色描边。" if k == 0 else "备选：") + label, k == 0))
q("treasure", "宝物卡（cards/treasure-*.png，40×56；数字代码画，宝石堆 PixelLab）", "12 种面值共用 4 档宝石堆", sets)

# 危险、神器卡
for kind, cn in S.HAZARDS:
    key = f"hz-{kind}"
    opts = []
    for i, c in enumerate(cands(key)):
        img = with_sel(key, v2path(c), lambda: F.hazard(kind, cn))
        opts.append(opt(c, f"{cn} {c}", save(board(img, 4), f"{key}-{c.replace('#', '_')}"), BASE[key]["why"] if i == 0 else "备选", i == 0))
    q(key, f"危险卡：{cn}（cards/hazard-{kind}.png）", "", opts)
for n, cn in S.ARTIFACTS:
    key = ["af-mask", "af-llama", "af-sun", "af-tumi", "af-idol"][n - 1]
    opts = []
    for i, c in enumerate(cands(key)):
        img = with_sel(key, v2path(c), lambda: F.artifact(n, key, cn))
        opts.append(opt(c, f"{cn} {c}", save(board(img, 4), f"{key}-{c.replace('#', '_')}"), BASE[key]["why"] if i == 0 else "备选", i == 0))
    q(key, f"神器卡：{cn}（cards/artifact-{n}.png）", "", opts)

# 牌背
opts = []
for i, c in enumerate(cands("back-tex")):
    img = with_sel("back-tex", f"out/r1/flux/{c}.png", F.back)
    opts.append(opt(c, f"牌背 {c}", save(board(img, 4), f"back-{c}"), BASE["back-tex"]["why"] if i == 0 else "备选", i == 0))
q("back", "牌背（cards/back.png）", "", opts)

# 帐篷、探险者
opts = []
for i, c in enumerate(cands("tent")):
    def two_rows():
        a = S.strip([F.tent_img(hx, sh, False) for _, hx, sh, _ in S.PLAYERS])
        b = S.strip([F.tent_img(hx, sh, True) for _, hx, sh, _ in S.PLAYERS])
        out = Image.new("RGBA", (a.width, a.height * 2 + 4), (0, 0, 0, 0))
        out.alpha_composite(a, (0, 0))
        out.alpha_composite(b, (0, a.height + 4))
        return out
    img = with_sel("tent", v2path(c), two_rows)
    desc = BASE["tent"]["why"] if i == 0 else "备选（这张正面没有门帘结构，「回营地」版和关门版看不出区别，选它要另做开门版）"
    opts.append(opt(c, f"帐篷 {c}", save(board(img, 3), f"tent-{c.replace('#', '_')}"), desc, i == 0))
q("tent", "玩家帐篷（players/tent-*.png 关门 = 还在神庙；*-home.png 门帘掀开亮灯 = 已回营地）", "上排关门、下排回营地", opts)
opts = []
for i, c in enumerate(cands("explorer")):
    img = with_sel("explorer", v2path(c), lambda: S.strip([F.explorer_img(hx) for _, hx, _, _ in S.PLAYERS]))
    opts.append(opt(c, f"探险者 {c}", save(board(img, 4), f"explorer-{c.replace('#', '_')}"), BASE["explorer"]["why"] if i == 0 else "备选", i == 0))
q("explorer", "探险者（players/explorer-*.png，16×24，也当头像）", "", opts)

# 按钮图标
for key, fn_name, cn in (("ch-torch", "torch", "继续挖"), ("ch-camp", "camp", "回营地")):
    opts = []
    for i, c in enumerate(cands(key)):
        img = with_sel(key, v2path(c), lambda: F.prep(key, 32, 32))
        opts.append(opt(c, f"{cn} {c}", save(board(img, 4), f"{key}-{c.replace('#', '_')}"), BASE[key]["why"] if i == 0 else "备选", i == 0))
    q(key, f"「{cn}」按钮图标（choice/{fn_name}.png，32×32）", "", opts)

# 图标一套
icon_keys = ["ic-gem", "ic-artifact", "ic-deck", "ic-tent", "ic-torch", "ic-wait", "ic-skull", "ic-crown", "ic-temple",
             "ic-fire", "ic-mummy", "ic-rocks", "ic-snake", "ic-spider"]
opts = []
for k in range(3):
    F.SEL.clear()
    F.SEL.update(copy.deepcopy(BASE))
    for key in icon_keys + ["ic-camp-fire"]:
        c = cands(key)[min(k, len(cands(key)) - 1)]
        F.SEL[key] = dict(F.SEL[key], src=v2path(c))
    img = S.strip([F.prep(key, 16, 16) for key in icon_keys[:5]] + [F.icon_camp()] + [F.prep(key, 16, 16) for key in icon_keys[5:]])
    F.SEL.clear()
    F.SEL.update(copy.deepcopy(BASE))
    opts.append(opt(f"set{k}", f"图标第 {k + 1} 套", save(board(img, 4), f"icons-set{k}"),
                    "宝石、神器、牌堆、帐篷、继续、离开（帐篷 + 小篝火）、未决定、骷髅、皇冠、局数神庙、五种危险" if k == 0 else "每样换成备选", k == 0))
q("icons", "16×16 图标（icons/*.png，显示 2×）", "已决定 hidden.png 是代码画的，不在这里", opts)

# 动画：火把
opts = []
for i, c in enumerate(cands("fx-torch")):
    frames = []
    for j in range(6):
        im = F.clean_alpha(Image.open(ART / f"out/r1/anim/{c}/{c}-{j:02d}.png").convert("RGBA")).crop((8, 0, 24, 32))
        bg = Image.new("RGBA", im.size, NIGHT)
        bg.alpha_composite(im)
        frames.append(bg.resize((96, 192), Image.NEAREST).convert("P", palette=Image.ADAPTIVE))
    p = OUT / f"fx-torch-{c}.gif"
    frames[0].save(p, save_all=True, append_images=frames[1:], duration=120, loop=0, disposal=2)
    opts.append(opt(c, f"火把 {c}", str(p), BASE["fx-torch"]["why"] if i == 0 else "备选", i == 0))
q("fx-torch", "火把动画（fx/torch.png，16×32 × 6 帧循环）", "", opts)

# 动画：塌方（PixelLab 版 vs 代码版）
coll = []
saved = copy.deepcopy(BASE)
for i, (label, has_px) in enumerate((("PixelLab 版", True), ("代码版（石块 + 抖动烟尘）", False))):
    F.SEL.clear()
    F.SEL.update(copy.deepcopy(saved))
    if not has_px:
        F.SEL.pop("fx-collapse", None)
    if has_px and "fx-collapse" not in F.SEL:
        continue
    strip = F.fx_collapse_px() if has_px else F.fx_collapse()
    frames = []
    for j in range(10):
        im = strip.crop((j * 64, 0, j * 64 + 64, 64))
        bg = Image.new("RGBA", im.size, NIGHT)
        bg.alpha_composite(im)
        frames.append(bg.resize((256, 256), Image.NEAREST).convert("P", palette=Image.ADAPTIVE))
    p = OUT / f"fx-collapse-{'px' if has_px else 'code'}.gif"
    frames[0].save(p, save_all=True, append_images=frames[1:] + [frames[-1]] * 8, duration=90, loop=0, disposal=2)
    coll.append(opt("px" if has_px else "code", label, str(p), saved.get("fx-collapse", {}).get("why", "") if has_px else "备选", i == 0 and has_px))
F.SEL.clear()
F.SEL.update(copy.deepcopy(BASE))
if coll:
    q("fx-collapse", "塌方动画（fx/collapse.png，64×64 × 10 帧播一次）", "", coll)

# 结算装饰
for key, w, h, cn, rel in (("banner", 160, 32, "结算横幅", "ui/banner.png"), ("chest", 64, 48, "胜者宝箱", "ui/chest.png")):
    opts = []
    for i, c in enumerate(cands(key)):
        img = with_sel(key, f"out/r1/flux/{c}.png", lambda: F.prep(key, w, h))
        opts.append(opt(c, f"{cn} {c}", save(board(img, 3), f"{key}-{c}"), BASE[key]["why"] if i == 0 else "备选", i == 0))
    q(key, f"{cn}（{rel}）", "", opts)

# 封面
covers = [("cover-1", "门洞宝藏", "火把照亮的梯形门洞，台阶上一堆发光绿宝石和一件金面具；最能说明「印加宝藏」"),
          ("cover-2", "塌方瞬间", "石块从顶上砸下、尘土飞扬，地上一支掉落的火把和散落的宝石"),
          ("cover-3", "营地夜景", "一排彩色帐篷围着篝火，远处神庙门洞透出火光")]
opts = []
for i, (c, label, desc) in enumerate(covers):
    img = Image.open(ART / f"out/covers/{c}.png").convert("RGBA")
    p = save(img.resize((768, 384), Image.NEAREST), f"{c}")
    opts.append(opt(c, label, p, desc + "（384×192，原图在 art/out/covers/）", i == 0))
q("cover", "大厅封面（384×192，不画字、不画人）", "", opts)

intro = ("印加宝藏正式美术（PixelLab，丛林神庙火把夜探）。每样素材我已经挑定一张（标「推荐」），已经导出成定稿；"
         "你想换哪张随时选，不选就按推荐。每张图上半是夜间底、下半是白天底，右边是 1× 原大。")
data = {"id": "art-gallery", "title": "印加宝藏：美术画廊（可随时换图）", "stage": "art", "blocking": False,
        "intro": intro, "questions": questions}
old = json.loads(DEC.read_text()) if DEC.exists() else {}
if "answer" in old:
    data["answer"] = old["answer"]
DEC.write_text(json.dumps(data, ensure_ascii=False, indent=2))
print(DEC, len(questions), "题")
