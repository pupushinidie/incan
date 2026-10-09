import { artifactValue, bustChance, deckInfo, redactGameForViewer } from "./engine.js";
import { ROUNDS, type Choice, type GameCommand, type GameState, type HazardType, type Player } from "./types.js";

/**
 * 印加宝藏的人机（「普通」难度）。思路见 ~/Desktop/游戏规则/印加宝藏-补充.md 第 1 节：
 *
 * 1. 只看自己座位能看到的东西：进来的状态先过 redactGameForViewer（已经脱敏的不再处理），
 *    所以牌堆顺序、种子、别人的帐篷、别人这一轮选了什么都拿不到。
 * 2. 单步前瞻：再翻一张平均多拿多少（gain）× 冒险系数 ρ，和「这一张塌方会丢掉的」（P_爆 × 现在离开的价值）比，
 *    前者大就继续，否则离开。硬规则：现在离开什么都拿不到、或者下一张不可能塌方时一律继续。
 * 3. 性格：每个座位一个 ρ ∈ [0.7, 1.8]，按同桌所有人的哈希排名分档（同桌的人一定拉开），整局不变；
 *    每次决定再乘 ±15% 的扰动。都用公开信息做哈希，不碰规则包的 rngState，同一局面结果可复现。
 * 4. 第 4、5 局按估计的落后分数加大 ρ，领先多时收一点（补充 1.5）。
 *
 * 对外：botCommand（服务器用）、botAdvice（带一句理由，教程的「提示」按钮用）、botPersonality。
 */

export const BOT_RHO_MIN = 0.7;
export const BOT_RHO_MAX = 1.8;
/** 每次决定的扰动幅度（±15%）。 */
export const BOT_NOISE = 0.15;
/** 现在离开的价值不超过这么多（而且路上没有神器）时一律继续。 */
export const TINY_LEAVE = 1;
/** 提示按钮用的冒险系数：中等胆量、不加扰动。 */
export const HINT_RHO = 1.3;

export interface BotOptions {
  /** 提示模式：ρ 固定为 HINT_RHO、不加扰动、不按比分调整（给真人看的建议要稳定、可解释）。 */
  readonly hint?: boolean;
  /** 直接指定性格 ρ（测试、模拟用），不给就按座位算 botPersonality。 */
  readonly rho?: number;
  /** 性格 ρ 的范围（模拟调参用），默认 [BOT_RHO_MIN, BOT_RHO_MAX]。 */
  readonly rhoRange?: readonly [number, number];
  /** 是否加 ±15% 扰动（默认加；hint 时不加）。 */
  readonly noise?: boolean;
  /** 第 4、5 局按估计比分调整 ρ（默认开；hint 时关）。 */
  readonly scoreAdjust?: boolean;
}

/** 这一步的账（理由里的数字都从这里来；界面可以拿来显示）。 */
export interface BotAnalysis {
  /** 还在神庙里的人数（含自己）。 */
  readonly inTemple: number;
  /** 自己（也是神庙里每个人）的携带宝石。 */
  readonly carried: number;
  /** 路上的余数宝石。 */
  readonly pathGems: number;
  /** 路上的神器件数、按下一件带出序号算的分值和。 */
  readonly pathArtifacts: number;
  readonly artifactPoints: number;
  /** 牌堆还剩几张。 */
  readonly deckCount: number;
  /** 下一张塌方的概率。 */
  readonly bust: number;
  /** 本局已经出现过的危险种类。 */
  readonly hazardsSeen: HazardType[];
  /** 再翻一张自己平均多拿的宝石（含翻到神器的估值）。 */
  readonly gain: number;
  /** 现在离开的估计价值（携带 + 分到的余数 + 神器 × 单独离开的机会）。 */
  readonly leaveValue: number;
  /** 继续的好处 (1 − P_爆) × gain，和继续的风险 P_爆 × leaveValue。 */
  readonly reward: number;
  readonly risk: number;
  /** 这一步实际用的冒险系数（性格 × 扰动 × 比分调整）。 */
  readonly rho: number;
  /** 临界 ρ = risk ÷ reward：ρ 比它大就继续。 */
  readonly criticalRho: number;
  /** 按哪条规则定的：empty = 离开拿不到东西；tiny = 离开只能带走 1 颗左右；safe = 不会塌方；formula = 公式。 */
  readonly rule: "empty" | "tiny" | "safe" | "formula";
  /** 第 4、5 局估计落后领先者多少分（负数 = 自己领先）；前几局和提示模式为 0。 */
  readonly behind: number;
}

export interface BotAdvice {
  readonly choice: Choice;
  /** 可以直接发给服务器的命令（带 turn）。 */
  readonly command: GameCommand;
  /** 一句玩家听得懂的理由（教程提示按钮直接显示）。 */
  readonly reason: string;
  readonly analysis: BotAnalysis;
}

/** FNV-1a 32 位哈希再搅一下 → [0, 1)。 */
function unit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function roster(state: GameState): string {
  return state.players.map((player) => `${player.id}:${player.name}`).join(",");
}

/**
 * 座位的性格 ρ（整局不变）。同桌所有人按哈希排名，第 r 名（0 开始）落在 [0.7, 1.8] 的第 r 档里，
 * 档内再随机偏一点。这样同一桌的人机一定拉开，不会总是同时离开（补充 1.4、1.9 第 1 条）。
 */
export function botPersonality(state: GameState, playerId: string, range: readonly [number, number] = [BOT_RHO_MIN, BOT_RHO_MAX]): number {
  const table = roster(state);
  const order = state.players
    .map((player) => ({ id: player.id, key: unit(`${table}#${player.id}`) }))
    .sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : 1));
  const rank = order.findIndex((entry) => entry.id === playerId);
  const n = state.players.length;
  const [low, high] = range;
  if (rank < 0 || n === 0) return (low + high) / 2;
  const jitter = unit(`${table}#${playerId}#slot`) - 0.5; // 档内 ±30%
  return low + ((high - low) * (rank + 0.5 + 0.6 * jitter)) / n;
}

/** 这一步的扰动系数（1 ± 15%），由座位、局数、决定轮、本局路径决定。 */
function noiseFactor(state: GameState, playerId: string): number {
  const path = state.path.map((card) => (card.kind === "treasure" ? card.gems : card.kind === "hazard" ? card.hazard : `A${card.artifact}`)).join(".");
  const u = unit(`${roster(state)}#${playerId}#${state.round}#${state.turn}#${path}`);
  return 1 + BOT_NOISE * (2 * u - 1);
}

/** 神器分：下一件带出的是第 claimed + 1 件，连拿 count 件的分值和。 */
function artifactPointsFor(claimed: number, count: number): number {
  let total = 0;
  for (let i = 1; i <= count; i += 1) total += artifactValue(claimed + i);
  return total;
}

/**
 * 这一局已经离开的人各自带回了多少宝石：这一局的路径和离开记录都是公开的，按规则重放一遍就能精确算出来。
 */
function bankedThisRound(state: GameState): Map<string, number> {
  const banked = new Map<string, number>();
  const leaving = state.departures.filter((departure) => departure.round === state.round);
  let inside = state.players.length;
  let carried = 0;
  let path = 0;
  state.path.forEach((card, index) => {
    if (card.kind === "treasure" && inside > 0) {
      carried += Math.floor(card.gems / inside);
      path += card.gems % inside;
    }
    for (const departure of leaving) {
      if (departure.after !== index + 1) continue;
      const k = departure.players.length;
      for (const id of departure.players) banked.set(id, carried + Math.floor(path / k));
      path %= k;
      inside -= k;
    }
  });
  return banked;
}

/**
 * 估计自己落后领先者多少分（只用公开信息）。神器分公开，直接算；别人的帐篷宝石看不到：
 * - 这一局带回的按路径和离开记录精确重放（bankedThisRound）；
 * - 前几局的按「每次活着离开时路上有几张牌」加权（塌方被困 = 0），用自己前几局的宝石 ÷ 自己的权重换算。
 */
function estimateBehind(state: GameState, me: Player): number {
  const thisRound = bankedThisRound(state);
  const weight = new Map<string, number>(state.players.map((player) => [player.id, 0]));
  for (const departure of state.departures) {
    if (departure.round === state.round) continue;
    for (const id of departure.players) weight.set(id, (weight.get(id) ?? 0) + departure.after);
  }
  const myWeight = weight.get(me.id) ?? 0;
  const myGems = me.tent ?? 0;
  const myEarlier = myGems - (thisRound.get(me.id) ?? 0);
  const perCard = myWeight > 0 ? myEarlier / myWeight : 4 / state.players.length;
  const artifactScore = (player: Player) => player.artifacts.reduce((sum, claim) => sum + claim.value, 0);
  const myScore = myGems + artifactScore(me);
  let best = -Infinity;
  for (const player of state.players) {
    if (player.id === me.id) continue;
    const gems = player.tent ?? (weight.get(player.id) ?? 0) * perCard + (thisRound.get(player.id) ?? 0);
    best = Math.max(best, gems + artifactScore(player));
  }
  return best === -Infinity ? 0 : best - myScore;
}

function hazardsSeen(state: GameState): HazardType[] {
  const seen: HazardType[] = [];
  for (const card of state.path) if (card.kind === "hazard" && !seen.includes(card.hazard)) seen.push(card.hazard);
  return seen;
}

function gemsText(value: number): string {
  if (value >= 9.95) return `${Math.round(value)}`;
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

function percentText(value: number): string {
  const pct = Math.round(value * 100);
  return pct === 0 && value > 0 ? "不到 1%" : `${pct}%`;
}

/** 按账写一句理由（补充 1.10 的口气）。 */
function reasonFor(choice: Choice, a: BotAnalysis): string {
  if (a.rule === "empty") return "现在离开什么也拿不到（手里没宝石，路上也没有余数和神器），继续挖。";
  if (a.rule === "tiny") return "现在离开只能带走 1 颗左右，提前收工不划算，继续挖。";
  if (a.rule === "safe") {
    return a.hazardsSeen.length === 0
      ? "这一局还没出过危险，下一张不可能塌方，放心继续。"
      : "出过的危险牌堆里都没有第二张了，下一张不可能塌方，放心继续。";
  }
  const bust = percentText(a.bust);
  const hazards = a.hazardsSeen.length;
  if (choice === "stay") {
    if (a.inTemple === 1) {
      return `只剩你一个人，下一张宝物全归你（平均约 ${gemsText(a.gain)} 颗），塌方的机会 ${bust}，继续挖。`;
    }
    const hold = a.carried > 0 ? `手里 ${a.carried} 颗` : "手里还没宝石";
    return `下一张塌方的机会约 ${bust}，${hold}，再挖一张平均能多拿 ${gemsText(a.gain)} 颗，值得继续。`;
  }
  if (a.pathArtifacts > 0 && a.inTemple <= 2) {
    const pieces = a.pathArtifacts > 1 ? `${a.pathArtifacts} 件神器（共 ${a.artifactPoints} 分）` : `${a.artifactPoints} 分的神器`;
    if (a.inTemple === 1) return `只剩你一个人，现在离开能带走路上的 ${pieces}，连同 ${a.carried + a.pathGems} 颗宝石。`;
    return `只剩你和另一个人，现在单独走能拿走 ${pieces}（两人一起走就谁都拿不到）。`;
  }
  const extra = a.pathGems > 0 ? `，还能分路上的 ${a.pathGems} 颗余数` : "";
  const danger = hazards >= 2 ? `已经出了 ${hazards} 种危险，下一张有 ${bust} 的机会全丢` : `下一张有 ${bust} 的机会全丢`;
  return `${danger}；手里 ${a.carried} 颗${extra}，先带回帐篷。`;
}

/**
 * 人机的建议：选「继续」还是「离开」，附一句理由和算账过程。
 * 不在决定阶段、或者这个人已经不在神庙里时返回 null。已经决定过的人也照样给建议（提示按钮可以显示「建议改成…」）。
 * 传进来的状态会先按这个座位脱敏，所以拿完整状态来调用也看不到隐藏信息。
 */
export function botAdvice(input: GameState, playerId: string, options: BotOptions = {}): BotAdvice | null {
  const redacted = input.deck.length === 0 && input.seed === undefined && input.rngState === undefined && input.log === undefined;
  const state = redacted ? input : redactGameForViewer(input, playerId);
  if (state.phase !== "decide") return null;
  const me = state.players.find((player) => player.id === playerId);
  if (!me?.inTemple) return null;

  const n = state.players.filter((player) => player.inTemple).length;
  const c = me.carried;
  const p = state.pathGems;
  const pathArtifacts = state.pathArtifacts.length;
  const artifactPoints = artifactPointsFor(state.artifactsClaimed, pathArtifacts);
  const info = deckInfo(state);
  const R = Math.max(1, info.total);
  const bust = bustChance(state);
  const seen = hazardsSeen(state);
  const nextArtifact = artifactValue(state.artifactsClaimed + pathArtifacts + 1);
  // 粗估：单独离开的机会（只剩自己 = 1，否则 0.5^(m−1)）；再翻一张 m 个人时自己平均多拿多少。
  const roughSolo = (m: number) => (m <= 1 ? 1 : 0.5 ** (m - 1));
  const gainFor = (m: number) => {
    let treasure = 0;
    for (const gems of info.treasures) treasure += Math.floor(gems / m);
    return treasure / R + (info.artifacts / R) * nextArtifact * roughSolo(m);
  };
  // 补充 1.3 的公式：现在离开 = 携带 + 余数（只剩自己全拿，否则按 2 人分）+ 神器 × 单独离开的机会。
  const leaveValue = c + (n === 1 ? p : p / 2) + artifactPoints * roughSolo(n);
  const gain = gainFor(n);
  const reward = (1 - bust) * gain;
  const risk = bust * leaveValue;

  let rho: number;
  let behind = 0;
  if (options.hint) {
    rho = options.rho ?? HINT_RHO;
  } else {
    rho = options.rho ?? botPersonality(state, playerId, options.rhoRange);
    if (options.noise !== false) rho *= noiseFactor(state, playerId);
    if (options.scoreAdjust !== false && state.round >= ROUNDS) {
      behind = estimateBehind(state, me);
      if (behind > 10) rho *= 1 + Math.min(behind, 40) / 40;
    }
  }

  let rule: BotAnalysis["rule"] = "formula";
  let choice: Choice;
  if (leaveValue <= 0) {
    rule = "empty";
    choice = "stay";
  } else if (leaveValue <= TINY_LEAVE && pathArtifacts === 0) {
    // 现在走也只能带走 1 颗左右：提前收工丢掉的是这一局后面所有的机会，不值得（B7）。
    rule = "tiny";
    choice = "stay";
  } else if (bust <= 0) {
    rule = "safe";
    choice = "stay";
  } else {
    choice = reward * rho >= risk ? "stay" : "leave";
  }

  const analysis: BotAnalysis = {
    inTemple: n,
    carried: c,
    pathGems: p,
    pathArtifacts,
    artifactPoints,
    deckCount: info.total,
    bust,
    hazardsSeen: seen,
    gain,
    leaveValue,
    reward,
    risk,
    rho,
    criticalRho: reward > 0 ? risk / reward : risk > 0 ? Infinity : 0,
    rule,
    behind,
  };
  return { choice, command: { type: "decide", choice, turn: state.turn }, reason: reasonFor(choice, analysis), analysis };
}

/**
 * 服务器用：轮到这个座位决定（在神庙里、这一轮还没决定）时返回命令，否则 null。
 * 服务器传进来的是 redactGameForViewer(game, playerId)；返回 null 或抛错时服务器按「离开」处理。
 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  const me = state.players.find((player) => player.id === playerId);
  if (state.phase !== "decide" || !me?.inTemple || me.decided) return null;
  return botAdvice(state, playerId)?.command ?? null;
}
