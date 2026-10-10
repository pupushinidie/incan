"""印加宝藏 正式美术第二批（接手后，2026-10-10）：r1 自查后要重画 / 补的东西。结果在 art/out/r1/ 同一套目录里。

- hz-spider2：r1 的蜘蛛是黑色的，压在暗红危险卡上看不清 → 紫灰身子 + 橙色腿环（spec 调色板的蜘蛛色）。
- hz-mummy2：r1 的木乃伊在咧嘴笑，不够吓人 → 双臂前伸、红眼。
- back-tex：r1 的牌背把印加阶梯十字画成了基督教十字架 → 只要苔石纹理，阶梯十字用代码画（simple.chakana）。
- 封面用 pixen 512×288 出、再裁 384×192（pixflux 封面偏暗、门洞不像印加）。
- 火把动画：用选中的火把（v2 torch）放进 32×32 画布做首帧，animate-with-text-v3。

用法：~/miniconda3/envs/quant/bin/python art/r2.py [名字 ...]   出过的跳过。单进程线程池并发（会员），不要多开进程。
"""
from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

import pixellab
import r1

OUT = r1.OUT
NO = r1.NO
SMALL = r1.SMALL

V2 = {
    "gems-1": ("one single large shiny faceted green emerald gemstone lying on the ground" + SMALL, 32, 24),
    "hz-spider2": ("a big hairy dark purple tarantula spider with bright orange banded legs and an orange spot on its back, "
                   "top-down view, eight legs spread out" + SMALL, 32, 32),
    "hz-mummy2": ("a menacing undead mummy shambling forward with both arms stretched out in front, wrapped in dirty grey-beige "
                  "linen bandages with dark gaps, small glowing red eyes, upper body" + SMALL, 32, 32),
}

FLUX = {
    "back-tex": ("dark mossy green stone slab texture seen flat from the front, tightly fitted irregular polygonal Inca stone blocks "
                 "with thin dark seams, a little moss in the seams, subtle, even lighting, plain, no symbols, " + NO,
                 36, 52, False, (941, 942, 943)),
}

COVER = ", cozy detailed 16-bit pixel art game cover illustration, rich colors, crisp clean pixels, no people, no text, no letters, no numbers, no logo"
PIXEN = {
    "pcover-door": ("night in the Andean jungle, a huge trapezoidal ancient Inca temple doorway built of massive fitted polygonal "
                    "stone blocks, narrower at the top, two burning torches on both sides casting warm orange light, a glowing heap "
                    "of green emerald gemstones and a golden Inca sun mask on the stone steps in front of the dark doorway, "
                    "hanging vines and big jungle leaves framing the picture" + COVER, (951, 952)),
    "pcover-collapse": ("inside an ancient Inca stone temple corridor at night, heavy polygonal stone blocks falling from the "
                        "ceiling in a cloud of dust, cracks in the walls, a dropped burning torch on the floor and scattered "
                        "glowing green emerald gemstones in the foreground, dramatic warm torchlight and deep green shadows" + COVER,
                        (953, 954)),
    "pcover-camp": ("an explorers camp at night at the edge of the Andean jungle, a row of small colorful canvas tents in red, blue, "
                    "yellow and green around a crackling campfire in the foreground, in the distance an ancient Inca stone temple "
                    "with a trapezoidal doorway glowing with torchlight among the trees, starry sky" + COVER, (955, 956)),
}


def torch_first_frame() -> Path:
    """选中的 v2 火把（selection.json 的 torch）裁干净，底对齐放进 32×32 画布正中，作为动画首帧。"""
    import final as F
    img = F.prep("torch", 16, 32, bottom=True)
    canvas = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    canvas.alpha_composite(img, (8, 0))
    p = OUT / "anim" / "torch-first.png"
    p.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(p)
    return p


ANIM = {
    # 名字: (动作, 种子)
    "anim-torch-a": ("the torch flame flickers and sways gently, small sparks rise", 7101),
    "anim-torch-b": ("the fire on top of the torch flickers, flame tips dance left and right", 7102),
    "anim-torch-c": ("the torch flame flickers gently", 7103),
}


def run(name: str) -> None:
    if name in V2:
        prompt, w, h = V2[name]
        folder = OUT / "v2" / name
        if folder.exists() and any(folder.glob("*.png")):
            return
        paths = pixellab.generate_async(name, {
            "description": prompt, "image_size": {"width": w, "height": h}, "no_background": True, "seed": 2901,
        }, folder, endpoint="/generate-image-v2")
        print(name, len(paths), "张", flush=True)
    elif name in FLUX:
        prompt, w, h, transparent, seeds = FLUX[name]
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (OUT / "flux" / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {"description": prompt, "image_size": {"width": w, "height": h},
                                             "detail": "highly detailed", "seed": seed}, OUT / "flux")
            print(target, "ok", flush=True)
    elif name in PIXEN:
        prompt, seeds = PIXEN[name]
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (OUT / "covers" / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {"description": prompt, "image_size": {"width": 512, "height": 288},
                                             "detail": "highly detailed", "seed": seed}, OUT / "covers",
                                    endpoint="/create-image-pixen")
            print(target, "ok", flush=True)
    elif name in ANIM:
        action, seed = ANIM[name]
        folder = OUT / "anim" / name
        if folder.exists() and any(folder.glob("*.png")):
            return
        first = torch_first_frame()
        pixellab.animate(name, {
            "first_frame": pixellab.b64_image(first), "last_frame": pixellab.b64_image(first),
            "action": action, "frame_count": 6, "no_background": True, "seed": seed,
        }, folder)
        print(name, "ok", flush=True)
    else:
        raise KeyError(name)


if __name__ == "__main__":
    names = sys.argv[1:] or (list(V2) + list(FLUX) + list(PIXEN))
    workers = int(os.environ.get("R2_WORKERS", "6"))

    def one(n):
        try:
            run(n)
        except Exception as error:
            print(n, "失败：", error, flush=True)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(one, names))
    print("全部跑完", flush=True)
