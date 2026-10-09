import type { Card, Choice, HazardType } from "@incan/game";

/**
 * 像素美术的地址。图片放在 public/art 下，文件名和尺寸以 art/spec.md 为准：
 * 现在是简洁版（art/simple.py 画的），正式美术定稿后同名同尺寸覆盖，这里不用改。
 * 所有图只按整数倍显示，加 image-rendering: pixelated。
 */
export const ART_ROOT = `${import.meta.env.BASE_URL}art/`;
const at = (path: string) => `${ART_ROOT}${path}`;

/** 卡面原图 40×56。 */
export const CARD_W = 40;
export const CARD_H = 56;

/** 座位 0–7 的玩家色 id（spec 1.3），按 game.players 里的顺序取。 */
export const SEAT_COLORS = ["red", "blue", "yellow", "green", "purple", "orange", "cyan", "white"] as const;
export type SeatColor = (typeof SEAT_COLORS)[number];
export const SEAT_HEX: Record<SeatColor, string> = {
  red: "#d63c2c",
  blue: "#2d5fe0",
  yellow: "#f7dc4a",
  green: "#2e9e4a",
  purple: "#b98af0",
  orange: "#f5962a",
  cyan: "#5fdce4",
  white: "#f2eee4",
};
export const seatColor = (index: number): SeatColor => SEAT_COLORS[((index % 8) + 8) % 8]!;

export function cardArt(card: Card): string {
  if (card.kind === "treasure") return at(`cards/treasure-${card.gems}.png`);
  if (card.kind === "hazard") return at(`cards/hazard-${card.hazard}.png`);
  return at(`cards/artifact-${card.artifact}.png`);
}

export type IconName = "gem" | "artifact" | "deck" | "tent" | "torch" | "camp" | "hidden" | "wait" | "skull" | "crown" | "temple";

export const art = {
  back: at("cards/back.png"),
  slot: at("cards/slot.png"),
  tent: (color: SeatColor, home = false) => at(`players/tent-${color}${home ? "-home" : ""}.png`),
  explorer: (color: SeatColor) => at(`players/explorer-${color}.png`),
  mark: (color: SeatColor) => at(`players/mark-${color}.png`),
  choiceIcon: (choice: Choice) => at(choice === "stay" ? "choice/torch.png" : "choice/camp.png"),
  choiceCard: (choice: Choice | "back") => at(`choice/card-${choice === "stay" ? "torch" : choice === "leave" ? "camp" : "back"}.png`),
  icon: (name: IconName) => at(`icons/${name}.png`),
  hazardIcon: (hazard: HazardType) => at(`icons/hazard-${hazard}.png`),
  scene: (day: boolean) => at(day ? "scene/day.png" : "scene/night.png"),
  floor: (day: boolean) => at(day ? "table/floor-day.png" : "table/floor-night.png"),
  banner: at("ui/banner.png"),
  chest: at("ui/chest.png"),
  divider: at("ui/divider.png"),
  badge: (value: number) => at(value >= 10 ? "ui/badge-10.png" : "ui/badge-5.png"),
  fx: {
    torch: at("fx/torch.png"),
    gem: at("fx/gem-spin.png"),
    sparkle: at("fx/sparkle.png"),
    collapse: at("fx/collapse.png"),
    crack: at("fx/crack.png"),
  },
};

/** 场景图（512×288）按整数倍放大铺满一块区域需要的尺寸（CSS background-size）。 */
export function coverSize(width: number, height: number): string {
  const scale = Math.max(1, Math.ceil(Math.max(width / 512, height / 288)));
  return `${512 * scale}px ${288 * scale}px`;
}
