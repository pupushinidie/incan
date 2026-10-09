"""印加宝藏 正式美术第一轮候选（PixelLab）。结果在 art/out/r1/（不进仓库）。

照 art/spec.md：丛林神庙火把夜探，印加式多边形石砌、梯形门洞（别像吴哥窟）；探险者别像印第安纳·琼斯；图里不要字。
- 场景 /create-image-pixen 512×288：夜、日各 3 个种子。
- 封面 / 牌背 / 结算横幅 / 宝箱：/create-image-pixflux。
- 小图（≤42px）全部 /generate-image-v2，一次 64 个：5 种危险、5 件神器（卡面插画 32×32）、宝石堆 3 档（32×24）、
  帐篷关/开（蓝帆布，之后按玩家色做渐变映射换色）、探险者（蓝上衣，同样换色）、继续/离开图标、火把（动画首帧）、
  落石（塌方动画用）、16px 图标 15 个。
卡框、数字、名字、玩家记号、神器分值徽章一直用代码画（art/simple.py），不让模型写字。

用法：~/miniconda3/envs/quant/bin/python art/r1.py [组或名字 ...]   不写就按优先级全跑；出过的跳过，可以中断后重跑接着出。
标准客户端会在全站排队（打印「在等位置」是正常的）。
"""
from __future__ import annotations

import sys

import pixellab

OUT = pixellab.ART / "out" / "r1"
NO = "no text, no letters, no numbers"

# ---------- 场景 ----------
SCENE_NIGHT = (
    "pixel art game table background, night inside an ancient Inca stone temple deep in the Andean jungle, a long corridor "
    "built of massive tightly fitted polygonal grey-green granite blocks with rounded edges, a tall trapezoidal doorway "
    "narrower at the top leading into darkness in the center, trapezoidal wall niches, hanging jungle vines and moss, "
    "burning wall torches casting warm orange firelight and long shadows, a few glowing green gemstones on the stone floor, "
    "moody deep greens and warm orange, calm empty floor area in the lower middle, no people, " + NO
)
SCENE_DAY = (
    "pixel art game table background, daytime inside an ancient Inca stone temple in the Andean jungle, a long corridor "
    "built of massive tightly fitted polygonal sandstone and granite blocks with rounded edges, a tall trapezoidal doorway "
    "narrower at the top leading into shadow in the center, trapezoidal wall niches, hanging vines and ferns, unlit torches "
    "on the walls, warm sunlight shafts falling through gaps in the jungle canopy from the upper left, a few green gemstones "
    "on the stone floor, calm empty floor area in the lower middle, no people, " + NO
)
SCENES = {"scene-night": (SCENE_NIGHT, (31, 32, 33)), "scene-day": (SCENE_DAY, (31, 32, 33))}

# ---------- pixflux：封面、牌背、结算装饰 ----------
COVER_STYLE = "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, no text, no letters, no logo, no numbers, no people"
FLUX = {
    # 名字: (提示词, 宽, 高, 透明, 种子们)
    "cover-1": ("night inside an ancient Inca temple, a trapezoidal stone doorway of massive fitted polygonal blocks lit by two burning "
                "torches, on the floor in front of it a pile of glowing green gemstones and a golden Inca sun mask, hanging vines, "
                "deep green and warm orange, " + COVER_STYLE, 384, 192, False, (901, 902)),
    "cover-2": ("a collapsing ancient Inca temple corridor at night, heavy stone blocks falling from the ceiling with dust, "
                "a dropped burning torch on the floor, scattered glowing green gemstones in the foreground, dramatic warm torchlight, "
                + COVER_STYLE, 384, 192, False, (903, 904)),
    "cover-3": ("an explorers camp at night at the edge of the Andean jungle, a row of small colorful canvas tents and a campfire, "
                "in the distance an ancient Inca stone temple doorway glowing with torchlight among the trees, starry sky, "
                + COVER_STYLE, 384, 192, False, (905, 906)),
    "back": ("a carved dark mossy green stone tablet seen from the front, a golden Inca stepped cross chakana symbol carved in "
             "the center, small carved step pattern border, subtle moss in the cracks, pixel art game card back, flat, " + NO,
             36, 52, False, (911, 912, 913)),
    "banner": ("a horizontal carved grey-green stone plaque banner with gold trim edges and dark red cloth swallowtail ribbon "
               "ends on both sides, blank empty middle, pixel art game ui element, " + NO, 160, 32, True, (921, 922, 923)),
    "chest": ("an open wooden treasure chest with gold corners overflowing with shiny green emerald gemstones and a small "
              "golden Inca mask, warm torchlight from the upper left, pixel art, " + NO, 64, 48, True, (931, 932, 933)),
}

# ---------- v2（一次 64 个） ----------
SMALL = ", pixel art game sprite, dark outline, lit by warm torchlight from the upper left, centered, transparent background, " + NO
ICON = ", tiny pixel art game icon, bold readable silhouette, dark outline, lit from the upper left, centered, transparent background, " + NO
V2 = {
    # 名字: (提示词, 宽, 高)
    "hz-fire": ("a roaring fire with tall orange and yellow flames rising from a few burning sticks" + SMALL, 32, 32),
    "hz-mummy": ("a scary undead mummy, head and shoulders wrapped in pale dirty linen bandages, glowing red eyes, one arm reaching forward" + SMALL, 32, 32),
    "hz-rocks": ("a cluster of heavy grey boulders falling down from above with small pebbles and dust" + SMALL, 32, 32),
    "hz-snake": ("a coiled green jungle viper snake rearing up with its mouth open showing fangs and a forked red tongue" + SMALL, 32, 32),
    "hz-spider": ("a big hairy black tarantula spider with eight legs and red markings hanging from a silk thread" + SMALL, 32, 32),
    "af-mask": ("an ancient golden Inca funeral mask with a radiating sun crown headdress and turquoise inlay eyes" + SMALL, 32, 32),
    "af-llama": ("a small golden Inca llama figurine statuette standing on a tiny base, side view" + SMALL, 32, 32),
    "af-sun": ("a golden Inca sun disc ornament with a calm face in the middle and radiating triangular rays" + SMALL, 32, 32),
    "af-tumi": ("a golden Inca tumi ceremonial knife standing upright, a wide half-moon semicircular blade at the bottom and a small "
                "god figure with a fan headdress on top of the handle" + SMALL, 32, 32),
    "af-idol": ("a seated golden Inca idol statue with a stepped headdress, square face and red ruby eyes, hands on knees" + SMALL, 32, 32),
    "gems-s": ("two shiny faceted green emerald gemstones lying on the ground" + SMALL, 32, 24),
    "gems-m": ("a small pile of five shiny faceted green emerald gemstones" + SMALL, 32, 24),
    "gems-l": ("a big heap of many shiny faceted green emerald gemstones" + SMALL, 32, 24),
    "tent": ("a small blue canvas camping tent, simple A-frame, front flap closed, three-quarter view, standing on the ground" + SMALL, 32, 24),
    "tent-home": ("a small blue canvas camping tent with its front flap tied open and warm orange lantern light glowing inside, "
                  "three-quarter view, standing on the ground" + SMALL, 32, 24),
    "explorer": ("a tiny jungle explorer adventurer standing, full body, front view, light straw wide brim sun hat, plain blue shirt, "
                 "khaki trousers, brown boots, holding a burning torch up in one hand, friendly" + SMALL, 16, 24),
    "ch-torch": ("a burning wooden torch held upright, cloth wrapped head, big bright orange flame" + SMALL, 32, 32),
    "ch-camp": ("a small beige canvas camping tent with a crackling campfire in front of it" + SMALL, 32, 32),
    "torch": ("a single burning wooden torch standing upright, thin wooden handle, bright orange flame on top" + SMALL, 16, 32),
    "boulder": ("a single grey granite boulder rock chunk" + SMALL, 16, 16),
    "ic-gem": ("a single shiny faceted green emerald gemstone" + ICON, 16, 16),
    "ic-artifact": ("a tiny golden idol statue" + ICON, 16, 16),
    "ic-deck": ("a small stack of face down cards with dark green stone backs" + ICON, 16, 16),
    "ic-tent": ("a small beige canvas tent" + ICON, 16, 16),
    "ic-torch": ("a burning wooden torch" + ICON, 16, 16),
    "ic-camp": ("a small beige tent with a campfire beside it" + ICON, 16, 16),
    "ic-wait": ("a wooden hourglass with sand" + ICON, 16, 16),
    "ic-skull": ("a white human skull" + ICON, 16, 16),
    "ic-crown": ("a small gold crown with green gems" + ICON, 16, 16),
    "ic-temple": ("a small grey stone stepped pyramid temple with a dark doorway" + ICON, 16, 16),
    "ic-fire": ("an orange flame" + ICON, 16, 16),
    "ic-mummy": ("a mummy head wrapped in pale bandages with red eyes" + ICON, 16, 16),
    "ic-rocks": ("two grey falling boulders" + ICON, 16, 16),
    "ic-snake": ("a coiled green snake" + ICON, 16, 16),
    "ic-spider": ("a black spider" + ICON, 16, 16),
}

# 优先级：先关键素材，再图标
ORDER = (["scene-night", "scene-day", "cover-1", "cover-2", "cover-3", "back", "banner", "chest"]
         + ["hz-fire", "hz-mummy", "hz-rocks", "hz-snake", "hz-spider",
            "af-mask", "af-llama", "af-sun", "af-tumi", "af-idol",
            "gems-s", "gems-m", "gems-l", "tent", "tent-home", "explorer", "ch-torch", "ch-camp", "torch", "boulder"]
         + [k for k in V2 if k.startswith("ic-")])


def run(name: str) -> None:
    if name in SCENES:
        prompt, seeds = SCENES[name]
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (OUT / "scenes" / f"{target}.png").exists():
                continue
            pixellab.generate_image(target, {
                "description": prompt, "image_size": {"width": 512, "height": 288},
                "detail": "highly detailed", "seed": seed,
            }, OUT / "scenes", endpoint="/create-image-pixen")
            print(target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
    elif name in FLUX:
        prompt, w, h, transparent, seeds = FLUX[name]
        folder = OUT / ("covers" if name.startswith("cover") else "flux")
        for seed in seeds:
            target = f"{name}-s{seed}"
            if (folder / f"{target}.png").exists():
                continue
            body = {"description": prompt, "image_size": {"width": w, "height": h}, "detail": "highly detailed", "seed": seed}
            if transparent:
                body |= {"no_background": True, "outline": "selective outline"}
            pixellab.generate_image(target, body, folder)
            print(target, "ok; spent", round(pixellab.spent_usd(), 4), flush=True)
    elif name in V2:
        prompt, w, h = V2[name]
        folder = OUT / "v2" / name
        if folder.exists() and any(folder.glob("*.png")):
            return
        paths = pixellab.generate_async(name, {
            "description": prompt, "image_size": {"width": w, "height": h}, "no_background": True, "seed": 1901,
        }, folder, endpoint="/generate-image-v2")
        print(name, len(paths), "张; spent", round(pixellab.spent_usd(), 4), flush=True)
    else:
        raise KeyError(name)


if __name__ == "__main__":
    if sys.argv[1:] == ["balance"]:
        print(pixellab.balance(), flush=True)
        sys.exit()
    names = sys.argv[1:] or ORDER
    try:
        print("余额", pixellab.balance(), flush=True)
    except Exception as error:
        print("查余额失败：", error, flush=True)
    for n in names:
        try:
            run(n)
        except Exception as error:  # 一样失败不挡后面的
            print(n, "失败：", error, flush=True)
    print("全部跑完; spent", round(pixellab.spent_usd(), 4), flush=True)
