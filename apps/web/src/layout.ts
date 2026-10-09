/**
 * 牌桌尺寸计算：量牌桌区域的实际宽高，挑卡牌和帐篷的整数倍（卡 40×56、帐篷 32×24 原图只按 1×/2×/3× 显示）。
 *
 * 桌面版牌桌从上到下：情况条 | 神庙路径 | 营地（每人一张帐篷卡） | 操作条。
 * 路径的倍数从 3× 往下试：一行能放 cols 张、高度能放 rows 行，cols × rows 够放「这局已翻的牌 + 下一张 + 探险者小队」
 * 并且至少 16 张时就用这个倍数；都不够时用能放下 2 行的最大倍数，多出来的牌叠在前一张上（不缩小，免得局中途牌突然变小）。
 * 手机（宽 < 760）：路径 1×，一行 8 张；营地 4 个一行；从上往下排，允许往下滚一点。
 * 各部分的固定尺寸要和 incan.css 对应。
 */
import { useLayoutEffect, useRef, useState } from "react";
import { CARD_H, CARD_W } from "./art.js";

export interface Layout {
  readonly mobile: boolean;
  /** 侧栏（状态、记录、聊天）一直显示；否则收进抽屉。 */
  readonly side: boolean;
  /** 路径卡的倍数。 */
  readonly s: number;
  /** 卡和卡之间的间距。 */
  readonly gap: number;
  /** 路径一行几张。 */
  readonly cols: number;
  /** 路径最多几行。 */
  readonly rows: number;
  /** 路径区的高度（固定，不随翻牌变）。 */
  readonly pathH: number;
  /** 帐篷的倍数。 */
  readonly ts: number;
  /** 营地一行几个。 */
  readonly campCols: number;
  /** 帐篷卡里名字用 24px（宽够时）还是 12px。 */
  readonly bigNames: boolean;
  /** 探险者小队画不画（手机上不画）。 */
  readonly party: boolean;
}

/** 桌面版各部分固定的尺寸（和 incan.css 对应）。 */
export const TOPBAR_H = 52;
export const SIDE_W = 300;
const SCREEN_PAD = 12;
const TABLE_PAD = 12;
const SECTION_GAP = 10;
const INFO_H = 56;
const PATH_PAD = 10;
const CARD_GAP = 8;
const ACTION_H = 92;
const CAMP_GAP = 8;

/** 帐篷卡高度：上面帐篷（和决定小卡并排），下面名字一行、数字一行。 */
export const campCardH = (ts: number, bigNames: boolean) => 8 + 24 * ts + 6 + (bigNames ? 28 : 18) + 4 + 28 + 8;

/** 探险者小队占几列（每个探险者 16×24 × 倍数，后一个叠在前一个上露出一半）。 */
export function partyWidth(count: number, s: number): number {
  if (count <= 0) return 0;
  return 16 * s + (count - 1) * 8 * s;
}

export function pickLayout(width: number, height: number, players: number, pathItems: number): Layout {
  if (width < 760) {
    const inner = width - 2 * 4;
    const gap = 6;
    const cols = Math.max(4, Math.floor((inner + gap) / (CARD_W + gap)));
    const rows = Math.max(3, Math.ceil(pathItems / cols));
    return {
      mobile: true,
      side: false,
      s: 1,
      gap,
      cols,
      rows,
      pathH: rows * CARD_H + (rows - 1) * gap + 2 * 4,
      ts: 1,
      campCols: 4,
      bigNames: false,
      party: false,
    };
  }
  const side = width >= 1200;
  const tableW = width - (side ? SIDE_W + 12 : 0);
  const innerW = tableW - 2 * TABLE_PAD;
  const innerH = height - 2 * TABLE_PAD;
  // 营地：每人一格
  const campW = (innerW - (players - 1) * CAMP_GAP) / players;
  const ts = campW >= 32 * 3 + 48 + 28 ? 3 : campW >= 32 * 2 + 24 + 20 ? 2 : 1;
  const bigNames = campW >= 176;
  const campH = campCardH(ts, bigNames);
  const pathAvail = innerH - INFO_H - campH - ACTION_H - 3 * SECTION_GAP;
  const pathW = innerW - 2 * PATH_PAD;
  const fits: { s: number; cols: number; rows: number }[] = [];
  for (const s of [4, 3, 2, 1]) {
    const cw = CARD_W * s;
    const ch = CARD_H * s;
    const cols = Math.floor((pathW + CARD_GAP) / (cw + CARD_GAP));
    const rows = Math.floor((pathAvail - 2 * PATH_PAD + CARD_GAP) / (ch + CARD_GAP));
    if (cols >= 6 && rows >= 2) fits.push({ s, cols, rows: Math.min(rows, 4) });
  }
  const partyCols = (s: number) => Math.ceil(partyWidth(players, s) / (CARD_W * s + CARD_GAP));
  const need = (s: number) => Math.max(pathItems + 1 + partyCols(s), 16);
  // 放得下就用最大的倍数；都放不下时用 2× 以上里最大的（后面的牌叠放），实在不行才用 1×
  const pick =
    fits.find((fit) => fit.cols * fit.rows >= need(fit.s)) ??
    fits.find((fit) => fit.s >= 2 && fit.s <= 3) ??
    fits[fits.length - 1] ??
    { s: 1, cols: 8, rows: 2 };
  const pathH = Math.max(0, Math.min(pathAvail, pick.rows * CARD_H * pick.s + (pick.rows - 1) * CARD_GAP + 2 * PATH_PAD));
  return {
    mobile: false,
    side,
    s: pick.s,
    gap: CARD_GAP,
    cols: pick.cols,
    rows: pick.rows,
    pathH,
    ts,
    campCols: players,
    bigNames,
    party: true,
  };
}

/** 量 ref 指向的元素（牌桌加侧栏那一块）的实际尺寸，算出布局。 */
export function useLayout(players: number, pathItems: number): [React.RefObject<HTMLDivElement | null>, Layout, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: window.innerWidth, height: window.innerHeight - TOPBAR_H - 2 * 8 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // 手机按窗口宽度判断（牌桌高度跟着内容走，不能拿来算）
  const mobile = window.innerWidth < 760;
  return [ref, pickLayout(mobile ? Math.min(box.width, window.innerWidth) : box.width, box.height, players, pathItems), box];
}

export const SCREEN = { SCREEN_PAD, TABLE_PAD, SECTION_GAP, INFO_H, PATH_PAD, CARD_GAP, ACTION_H };
