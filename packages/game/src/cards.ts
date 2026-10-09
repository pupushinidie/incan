import { HAZARD_NAMES, HAZARD_TYPES, type Card, type HazardType } from "./types.js";

/**
 * 写牌的简写（预览、测试、教程剧本用）：
 * - 数字 n：n 颗宝石的宝物卡；
 * - "fire" / "mummy" / "rocks" / "snake" / "spider"：危险；
 * - "A1"…"A5"：第几件神器；"artifact"：牌堆里编号最小的那件神器；
 * - 也可以直接写 Card 对象。
 */
export type CardSpec = Card | number | HazardType | "artifact" | `A${number}`;

/** 简写 → 卡。"artifact"（不指定是哪件）返回 artifact = 0，由调用的人去配具体哪一件。 */
export function parseCard(spec: CardSpec): Card {
  if (typeof spec === "number") return { kind: "treasure", gems: spec };
  if (typeof spec === "object") return spec;
  if ((HAZARD_TYPES as readonly string[]).includes(spec)) return { kind: "hazard", hazard: spec as HazardType };
  if (spec === "artifact") return { kind: "artifact", artifact: 0 };
  const match = /^A([1-5])$/.exec(spec);
  if (match) return { kind: "artifact", artifact: Number(match[1]) };
  throw new Error(`看不懂这张牌：${String(spec)}`);
}

/** 牌的中文名（日志、调试牌桌用）：「宝物 11」「火焰」「神器 2」。 */
export function cardLabel(card: Card): string {
  if (card.kind === "treasure") return `宝物 ${card.gems}`;
  if (card.kind === "hazard") return HAZARD_NAMES[card.hazard];
  return `神器 ${card.artifact}`;
}
