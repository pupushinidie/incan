/**
 * 印加宝藏的状态、命令、事件类型。这是对外接口：界面、人机、教程、验收都按这里写。
 * 规则出处：~/Desktop/游戏规则/印加宝藏.md + 印加宝藏-补充.md（勘误 E1–E11）+ 开工拍板。
 */

/** 五种危险：火焰、木乃伊、落石、蛇、蜘蛛，每种 3 张。 */
export const HAZARD_TYPES = ["fire", "mummy", "rocks", "snake", "spider"] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

export const HAZARD_NAMES: Record<HazardType, string> = {
  fire: "火焰",
  mummy: "木乃伊",
  rocks: "落石",
  snake: "蛇",
  spider: "蜘蛛",
};

/** 每种危险的张数。 */
export const HAZARD_COPIES = 3;

/** 15 张宝物卡上的宝石数（含 17 那张），合计 124。 */
export const TREASURES: readonly number[] = [1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17];

/** 一共打几局。 */
export const ROUNDS = 5;

/** 神器一共 5 件；第 n 局开局时把第 n 件洗进牌堆（开了「无神器」就不放）。 */
export const ARTIFACT_COUNT = 5;

export interface TreasureCard {
  readonly kind: "treasure";
  /** 卡上的宝石数。 */
  readonly gems: number;
}

export interface HazardCard {
  readonly kind: "hazard";
  readonly hazard: HazardType;
}

export interface ArtifactCard {
  readonly kind: "artifact";
  /** 第几件神器（1–5，就是它被洗进牌堆的那一局）。只用来区分图案，计分看带出顺序。 */
  readonly artifact: number;
}

export type Card = TreasureCard | HazardCard | ArtifactCard;

/** 继续挖（手电筒）/ 离开（营地）。 */
export type Choice = "stay" | "leave";

/** 一件被带出神庙的神器。 */
export interface ClaimedArtifact {
  /** 第几件神器（1–5，图案用）。 */
  readonly artifact: number;
  /** 整局第几件被带出神庙的（1–5）：第 1–3 件 5 分，第 4–5 件 10 分。作废的神器不占序号。 */
  readonly order: number;
  /** 分值：5 或 10。 */
  readonly value: number;
  /** 在第几局带出的。 */
  readonly round: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /**
   * 本局还在神庙里。离开后为 false。
   * 局末（roundEnd）塌方时被困在里面的人保持 true（界面据此标「被困」），下一局开始时所有人重新为 true。
   */
  inTemple: boolean;
  /** 本局在第几张牌之后离开（离开时的 path.length）；还在神庙里为 null。公开。 */
  leftAfter: number | null;
  /** 本局携带的宝石（公开，E9）：同一时刻还在神庙里的人一定相等；离开时存进帐篷后归 0，塌方时清零。 */
  carried: number;
  /**
   * 帐篷里的宝石（隐藏）：只有本人看得到；别人的视角里是 null。
   * 房主开了「观战看帐篷」时观战的人看得到；对局结束（gameOver）后所有人都看得到。
   */
  tent: number | null;
  /** 带出的神器（公开，E8），按带出顺序。 */
  artifacts: ClaimedArtifact[];
  /** 当前决定轮里是否已经决定（公开：只公开「已决定 / 未决定」）。 */
  decided: boolean;
  /**
   * 当前决定轮的选择：本人始终看得到；别人只在亮出（reveal）阶段看得到，决定中（decide）是 null。
   * 下一张牌翻出时清空。
   */
  choice: Choice | null;
}

/**
 * 阶段（谁在等什么）：
 * - start：新一局开始，路径为空。不用决定，服务器停一下后翻第一张（advance）。
 * - decide：翻出一张后，神庙里的人同时决定继续 / 离开（命令 decide / undecide）。限时，超时默认离开。
 * - reveal：最后一个人决定后立刻亮出所有选择、完成离开结算。服务器停一下后翻下一张；神庙里没人了就结束本局（advance）。
 * - skip：本局第一张就是危险（E10）：不用决定，服务器停一下后直接翻下一张（advance）。
 * - roundEnd：本局结束（全员离开或塌方），服务器停几秒后开下一局；第 5 局结束后进入 gameOver（advance）。
 * - gameOver：对局结束，finalResult 有结果。
 */
export type Phase = "start" | "decide" | "reveal" | "skip" | "roundEnd" | "gameOver";

/** 自动推进的阶段（服务器到点调用 advance）。 */
export const AUTO_PHASES: readonly Phase[] = ["start", "reveal", "skip", "roundEnd"];

export interface Config {
  readonly playerCount: number;
  /** 一共几局（5）。 */
  readonly rounds: number;
  /** 开房选项「无神器」（法/德原版玩法）：整局不放神器。 */
  readonly noArtifacts: boolean;
  /** 决定限时（秒），超时默认离开。 */
  readonly decideTimeoutSec: number;
  /** 自动推进阶段的停顿（毫秒），给界面放动画；服务器可以按环境变量整体缩放。 */
  readonly pauseMs: {
    /** 新一局开始到翻第一张。 */
    readonly start: number;
    /** 第一张是危险，提示后翻下一张。 */
    readonly skip: number;
    /** 亮出选择、没人离开时，到翻下一张。 */
    readonly reveal: number;
    /** 亮出选择、有人离开（宝石飞进帐篷）时，到翻下一张。 */
    readonly revealLeave: number;
    /** 局末停多久开下一局。 */
    readonly roundEnd: number;
  };
}

/** 开房时可以选的选项（房主在等候房间里可以改）。 */
export interface GameOptions {
  /** 无神器：整局不放神器（默认关）。 */
  readonly noArtifacts: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { noArtifacts: false };

/**
 * 命令。turn 是这条命令针对的决定轮（state.turn）：带上而且和当前不一致时拒绝（防止上一张牌的决定落到下一张上）；
 * 不带就算当前这一轮。界面和人机都应该带上。
 */
export type GameCommand =
  /** 决定继续 / 离开；已经决定过的再发一次就是改选。 */
  | { readonly type: "decide"; readonly choice: Choice; readonly turn?: number }
  /** 撤回自己的决定（最后一个人决定之前都可以）。 */
  | { readonly type: "undecide"; readonly turn?: number };

/** 一次离开（公开记录）：谁、第几局、第几张牌之后、带走了哪几件神器。不记宝石数。 */
export interface Departure {
  readonly round: number;
  /** 离开时路径上有几张牌。 */
  readonly after: number;
  /** 同时离开的人（座位 id）。 */
  readonly players: string[];
  /** 单独离开时带走的神器（只有 1 人离开时可能非空）。 */
  readonly artifacts: ClaimedArtifact[];
}

/** 一局的结果（公开）。 */
export interface RoundResult {
  readonly round: number;
  /** allLeft：所有人都离开了；collapse：同种危险第二次出现，塌方。 */
  readonly reason: "allLeft" | "collapse";
  /** 塌方的危险种类（allLeft 时为 null）。这张第二次出现的危险永久移出游戏。 */
  readonly hazard: HazardType | null;
  /** 塌方时还在神庙里、本局宝石作废的人。 */
  readonly caught: string[];
  /** 被困的人每人丢掉的携带宝石。 */
  readonly lostGems: number;
  /** 局末路径上没人分的余数宝石（作废，E4）。 */
  readonly pathGemsDiscarded: number;
  /** 局末还躺在路径上、没人拿的神器（作废，不占带出序号，E3、E5）。 */
  readonly artifactsDiscarded: number[];
  /** 本局一共翻出几张牌。 */
  readonly cards: number;
}

export interface ScoreLine {
  readonly player: string;
  /** 帐篷里的宝石，1 颗 1 分。 */
  readonly gems: number;
  readonly artifacts: ClaimedArtifact[];
  /** 神器分（按带出顺序：第 1–3 件 5 分，第 4–5 件 10 分）。 */
  readonly artifactPoints: number;
  readonly total: number;
  /** 名次（1 开始，并列同名次）：先比总分，再比神器件数。 */
  readonly rank: number;
}

export interface FinalResult {
  /** 按名次排好。 */
  readonly scores: ScoreLine[];
  /** 获胜者：总分最高，同分比神器件数，再一样就并列获胜。 */
  readonly winners: string[];
}

/**
 * 事件：每次 apply / advance 产生的事件放在 state.events（只保留最近这一步的）。
 * 事件里没有藏起来的信息（不含别人的选择、帐篷宝石数），直接发给所有人。
 */
export type GameEvent =
  /** 新一局开始：牌堆洗好了。newArtifact 是这局新放进去的神器（无神器时为 null）。 */
  | {
      readonly type: "RoundStarted";
      readonly round: number;
      readonly deckCount: number;
      readonly deckArtifacts: number;
      readonly newArtifact: number | null;
    }
  /**
   * 翻出一张牌。index 是它在 path 里的位置。宝物：神庙里 inTemple 个人每人分 share 颗，余 remainder 颗留在路径上。
   * 危险：first 表示本局第一次出现（第二次出现时同一步还有 Collapse 事件）。神器：放在路径上。
   */
  | {
      readonly type: "CardRevealed";
      readonly card: Card;
      readonly index: number;
      readonly inTemple: number;
      readonly share: number;
      readonly remainder: number;
      readonly first: boolean;
    }
  /** 本局第一张就是危险：不用决定，直接翻下一张（E10）。界面弹一句提示。 */
  | { readonly type: "FirstHazardSkipped"; readonly hazard: HazardType }
  /** 有人决定了（不公开选了什么）。 */
  | { readonly type: "Decided"; readonly player: string }
  /** 有人撤回了决定。 */
  | { readonly type: "Undecided"; readonly player: string }
  /** 这些人超时没决定，按默认替他们选了「离开」。 */
  | { readonly type: "TimedOut"; readonly players: string[] }
  /** 所有人都决定了，同时亮出。 */
  | { readonly type: "ChoicesRevealed"; readonly stay: string[]; readonly leave: string[] }
  /**
   * 离开结算：players 平分路径余数，每人 share 颗（pathGemsBefore → pathGemsAfter），连同本局携带（carried 颗，所有离开的人相同）存进帐篷。
   * 只有 1 人离开时他拿走路径上所有神器（artifacts，按带出顺序编号）；多人同时离开时神器留在路上。
   */
  | {
      readonly type: "PlayersLeft";
      readonly players: string[];
      readonly carried: number;
      readonly share: number;
      readonly pathGemsBefore: number;
      readonly pathGemsAfter: number;
      readonly artifacts: ClaimedArtifact[];
    }
  /** 同种危险第二次出现：塌方。caught 里的人每人丢 lostGems 颗；这张危险永久移出（removedNow 是这种危险累计移出几张）。 */
  | {
      readonly type: "Collapse";
      readonly hazard: HazardType;
      readonly caught: string[];
      readonly lostGems: number;
      readonly removedNow: number;
    }
  /** 本局结束：塌方的同一步，或者最后几个人离开后的下一次 advance。 */
  | { readonly type: "RoundEnded"; readonly result: RoundResult }
  | { readonly type: "GameEnded"; readonly result: FinalResult };

export interface GameState {
  readonly config: Config;
  phase: Phase;
  /** 第几局（1–5）。 */
  round: number;
  players: Player[];
  /** 本局翻出的牌，按翻出顺序（公开）。下一局开始时清空；局末（roundEnd）时还在，界面画塌方用。 */
  path: Card[];
  /** 路径上累计的余数宝石（公开）。局末清零（E4）。 */
  pathGems: number;
  /** 还躺在路径上、没人拿的神器 id（公开）；被单独离开的人拿走后从这里去掉，path 里那张牌还在（界面画成「已被拿走」）。 */
  pathArtifacts: number[];
  /** 牌堆还剩几张（公开）。 */
  deckCount: number;
  /** 牌堆里还有几件神器（公开，E1：没翻出的神器留在牌堆带到下一局）。 */
  deckArtifacts: number;
  /** 每种危险已经永久移出几张（0–2，公开，E2）。 */
  removed: Record<HazardType, number>;
  /** 整局已经带出神庙的神器件数（0–5，公开），下一件的分值看它。 */
  artifactsClaimed: number;
  /** 作废的神器 id（公开）。 */
  artifactsLost: number[];
  /** 决定轮编号：每进入一次 decide 阶段 +1。decide / undecide 不改它；服务器的计时 key 用它。 */
  turn: number;
  /** 公开的离开记录（整局）。 */
  departures: Departure[];
  /** 已结束各局的结果（公开）。 */
  history: RoundResult[];
  /** 最近一步产生的事件。 */
  events: GameEvent[];
  finalResult?: FinalResult;
  /** 每次 apply / advance +1；界面看它变没变触发动画。 */
  version: number;
  /** 以下只在服务端，redactGameForViewer 去掉：牌堆顺序（发给客户端是空数组）、种子、随机数状态、动作序列。 */
  deck: Card[];
  seed?: number;
  rngState?: number;
  log?: LogEntry[];
}

/** 动作序列（只在服务端）：同一种子重放这串就能复现整局。 */
export type LogEntry =
  | { readonly player: string; readonly command: GameCommand }
  | { readonly player: ""; readonly command: { readonly type: "ADVANCE" } }
  | { readonly player: ""; readonly command: { readonly type: "TIMEOUT"; readonly players: string[] } };
