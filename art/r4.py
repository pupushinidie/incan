"""印加宝藏 大厅封面（2026-10-10）：/create-image-pixen 直接出 384×192（pixen 支持这个尺寸，比 pixflux 封面亮、门洞像印加）。
提示词在 r2.PIXEN。结果在 art/out/r1/covers/pcover384-*.png；挑定的三张复制成 art/out/covers/cover-{1,2,3}.png。
用法：~/miniconda3/envs/quant/bin/python art/r4.py   单进程线程池。
"""
from concurrent.futures import ThreadPoolExecutor

import pixellab
import r2

JOBS = [("door", 961), ("door", 962), ("door", 967), ("collapse", 963), ("collapse", 964), ("camp", 965), ("camp", 966)]


def one(job):
    k, s = job
    target = f"pcover384-{k}-s{s}"
    if (r2.OUT / "covers" / f"{target}.png").exists():
        return
    prompt, _ = r2.PIXEN["pcover-" + k]
    try:
        pixellab.generate_image(target, {"description": prompt, "image_size": {"width": 384, "height": 192},
                                         "detail": "highly detailed", "seed": s}, r2.OUT / "covers", endpoint="/create-image-pixen")
        print(target, "ok", flush=True)
    except Exception as e:
        print(target, "失败", e, flush=True)


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(one, JOBS))
