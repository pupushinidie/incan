"""印加宝藏 正式美术第三批（2026-10-10）：r1 图标自查后重画的几样。结果在 art/out/r1/v2/<名字>/。

- ic-camp2：r1 的「离开」图标是一团糊的米色帐篷，认不出 → 篝火（回营地）。
- ic-spider2：r1 的蜘蛛是黑的，夜间底上看不见 → 紫身橙腿，和危险卡一致。
- ic-deck2：r1 的牌堆像一块灰石板 → 三张叠着的扣牌，深绿牌背、金色小记号。
- ic-temple2：r1 的神庙像圆顶小屋 → 阶梯小金字塔 + 梯形门。
- ch-camp2：「回营地」按钮图标（32×32），米色帐篷 + 篝火。
用法：~/miniconda3/envs/quant/bin/python art/r3.py   单进程线程池（会员上限 10）。
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

import pixellab
import r1

OUT = r1.OUT
ICON = r1.ICON
SMALL = r1.SMALL

V2 = {
    "ic-camp2": ("a small crackling campfire with crossed wooden logs and bright orange flames" + ICON, 16, 16),
    "ic-spider2": ("a purple spider with bright orange banded legs, top-down view" + ICON, 16, 16),
    "ic-deck2": ("a small stack of three face-down playing cards with dark green backs and a tiny gold symbol, slightly fanned" + ICON, 16, 16),
    "ic-temple2": ("a tiny grey stone stepped pyramid with a dark trapezoid doorway at the bottom" + ICON, 16, 16),
    "ch-camp2": ("a small beige canvas A-frame camping tent with its door open and a crackling campfire with logs in front of it, "
                 "warm light" + SMALL, 32, 32),
}


def run(name: str) -> None:
    prompt, w, h = V2[name]
    folder = OUT / "v2" / name
    if folder.exists() and any(folder.glob("*.png")):
        return
    paths = pixellab.generate_async(name, {
        "description": prompt, "image_size": {"width": w, "height": h}, "no_background": True, "seed": 3901,
    }, folder, endpoint="/generate-image-v2")
    print(name, len(paths), "张", flush=True)


if __name__ == "__main__":
    def one(n):
        try:
            run(n)
        except Exception as error:
            print(n, "失败：", error, flush=True)

    with ThreadPoolExecutor(max_workers=int(os.environ.get("R3_WORKERS", "10"))) as pool:
        list(pool.map(one, list(V2)))
    print("全部跑完", flush=True)
