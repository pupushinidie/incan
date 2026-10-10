"""印加宝藏 正式美术第五批（2026-10-10）：塌方动画试 PixelLab animate（代码版的石块太小、烟尘太淡）。
首帧 = 选中的 4 块 v2 石块（boulder-*）摆在 64×64 画布上半部；动作写小幅的「石块落下、扬起尘土」。
结果在 art/out/r1/anim/anim-collapse-<种子>/。用法：~/miniconda3/envs/quant/bin/python art/r5.py
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from PIL import Image

import final as F
import pixellab
import r1

OUT = r1.OUT / "anim"
ACTIONS = {
    7201: "the stone blocks fall down to the ground and a cloud of brown dust rises",
    7202: "rocks drop down from above and crash onto the floor, dust puffs up",
    7203: "the boulders tumble down and land on the ground with dust",
}


def first_frame():
    rocks = [F.trim(F.prep(k, 16, 16)) for k in F.SEL["boulders"]["keys"]]
    c = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    for r, (x, y) in zip(rocks, [(10, 4), (30, 0), (44, 8), (22, 14)]):
        c.alpha_composite(r, (x, y))
    p = OUT / "collapse-first.png"
    p.parent.mkdir(parents=True, exist_ok=True)
    c.save(p)
    return p


def run(seed: int):
    folder = OUT / f"anim-collapse-{seed}"
    if folder.exists() and any(folder.glob("*.png")):
        return
    p = OUT / "collapse-first.png"  # 主线程先画好，线程里只读（并发写同一个文件会读到空图）
    pixellab.animate(f"anim-collapse-{seed}", {
        "first_frame": pixellab.b64_image(p), "action": ACTIONS[seed], "frame_count": 10,
        "no_background": True, "seed": seed,
    }, folder)
    print(seed, "ok", flush=True)


if __name__ == "__main__":
    first_frame()

    def one(s):
        try:
            run(s)
        except Exception as e:
            print(s, "失败：", e, flush=True)
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(one, ACTIONS))
    print("全部跑完", flush=True)
