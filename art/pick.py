"""挑图用：把 v2 候选按 final.py 的做法合成到实际用途里（卡面 / 帐篷 / 图标），1× 和 2× 并排，夜间底和白天底各一行。
用法：python art/pick.py <输出名> <键>:<编号,编号,...> [<键>:...]
      键 = art/out/r1/v2/ 下的文件夹名（hz-fire、af-mask、gems-m、tent、explorer、ic-gem……）
输出：art/out/pick/<输出名>.png
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import final as F  # noqa: E402
import simple as S  # noqa: E402

ART = Path(__file__).resolve().parent
V2 = ART / "out" / "r1" / "v2"
OUT = ART / "out" / "pick"
NIGHT = (14, 26, 28, 255)
DAY = (244, 240, 228, 255)


def cand_path(key: str, i: int) -> str:
    folder = V2 / key
    p = folder / (f"{key}.png" if i == 0 else f"{key}-{i}.png")
    if not p.exists():  # 第二批的文件夹（如 hz-spider2）
        raise FileNotFoundError(p)
    return str(p.relative_to(ART))


def render(key: str, i: int) -> Image.Image:
    base = key if key == "gems-1" else key.rstrip("0123456789")
    F.SEL[base] = {"src": cand_path(key, i)}
    if base.startswith("hz-"):
        kind = base[3:]
        return F.hazard(kind, dict(S.HAZARDS)[kind])
    if base.startswith("af-"):
        names = ["af-mask", "af-llama", "af-sun", "af-tumi", "af-idol"]
        n = names.index(base) + 1
        return F.artifact(n, base, S.ARTIFACTS[n - 1][1])
    if base.startswith("gems-"):
        v = {"gems-1": 1, "gems-s": 3, "gems-m": 7, "gems-l": 15}[base]
        return F.treasure(v)
    if base in ("tent", "tent-home"):
        F.SEL["tent"] = F.SEL[base]
        imgs = [F.tent_img(hx, sh, h) for _, hx, sh, _ in S.PLAYERS for h in (False, True)]
        return S.strip(imgs)
    if base == "explorer":
        return S.strip([F.explorer_img(hx) for _, hx, _, _ in S.PLAYERS])
    if base in ("ch-torch", "ch-camp", "ch-camp2"):
        return F.prep(base, 32, 32)
    if base == "torch":
        return F.prep(base, 16, 32)
    return F.prep(base, 16, 16)


def main() -> None:
    name = sys.argv[1]
    tiles = []
    for arg in sys.argv[2:]:
        key, nums = arg.split(":")
        for n in nums.split(","):
            try:
                tiles.append((f"{key}#{n}", render(key, int(n))))
            except Exception as e:  # 放不进框之类
                print(key, n, "失败：", e)
    pad = 8
    rows = []
    for label, img in tiles:
        a = img.resize((img.width * 2, img.height * 2), Image.NEAREST)
        w = img.width + a.width + pad * 3
        h = max(img.height, a.height) * 2 + pad * 3 + 12
        tile = Image.new("RGBA", (w, h), (40, 40, 40, 255))
        d = ImageDraw.Draw(tile)
        d.text((pad, 0), label, fill=(255, 255, 0))
        for r, bg in enumerate((NIGHT, DAY)):
            y = 12 + pad + r * (a.height + pad)
            band = Image.new("RGBA", (w - pad * 2, a.height), bg)
            tile.alpha_composite(band, (pad, y))
            tile.alpha_composite(img, (pad * 2, y))
            tile.alpha_composite(a, (pad * 2 + img.width + pad, y))
        rows.append(tile)
    maxw = 1500
    x = y = 0
    rowh = 0
    placed = []
    for t in rows:
        if x + t.width > maxw:
            x = 0
            y += rowh + 4
            rowh = 0
        placed.append((t, x, y))
        x += t.width + 4
        rowh = max(rowh, t.height)
    sheet = Image.new("RGBA", (min(maxw, max(px + t.width for t, px, _ in placed)), y + rowh), (25, 25, 25, 255))
    for t, px, py in placed:
        sheet.alpha_composite(t, (px, py))
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(OUT / f"{name}.png")
    print(OUT / f"{name}.png", sheet.size)


if __name__ == "__main__":
    main()
