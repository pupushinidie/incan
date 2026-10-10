/**
 * 新手教程的剧本（印加宝藏）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：前两局的牌序按剧本摆好（TUTORIAL_ROUND1 / TUTORIAL_ROUND2），
 * 两个咕噜按剧本选，所以「两人一起走拿不到神器」「单独回营地带走神器」「同种危险第二次出现塌方」这几幕一定会发生。
 * 剧本停在第 3 局开头，之后接练习局：两个咕噜交给人机，牌堆用这局自己的种子洗。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，tutorial.test.ts 会检查剧本还能不能从头走到尾。
 *
 * 和轮流行动的游戏不一样的地方：这款是同时决定 + 服务器自动推进（翻牌、局末），
 * 所以剧本里的一步是 TutorialMove（谁 + 什么命令），自动推进写成 player 为空、命令 advance 的一步。
 */
import { parseCard, type CardSpec } from "./cards.js";
import { advance, apply, bustChance, createGame, isAutoPhase, stackDeck } from "./engine.js";
import type { Card, GameCommand, GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

/** 剧本里的一步：某个座位发命令，或者（player 为空）自动推进一步（翻牌、结束本局、开下一局）。 */
export type TutorialMove =
  | { readonly player: string; readonly command: GameCommand }
  | {
      readonly player: "";
      readonly command: { readonly type: "advance" };
      /** 推进后把这几张牌摆到牌堆顶（剧本给新一局摆牌序用）。 */
      readonly top?: readonly CardSpec[];
    };

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px），最多两句。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明（比如「键盘 1」在手机上不成立）。 */
  readonly noteTouch?: string;
  /** 高亮哪个元素：网页里 data-tutorial 的值（见 anchorVisible）。 */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: TutorialMove })
  /** 咕噜们按剧本选、牌按剧本翻，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialMove[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_BOTS = [
  { id: "p2", name: "咕噜一号" },
  { id: "p3", name: "咕噜二号" },
] as const;

/** 第 1 局的牌序：宝物 11（3 人每人 3 颗、余 2）→ 火焰（第一次，没事）→ 神器 → 宝物 5（只剩你，全拿）。 */
export const TUTORIAL_ROUND1: readonly CardSpec[] = [11, "fire", "A1", 5];
/** 第 2 局的牌序：火焰（第一张就是危险，直接翻下一张）→ 宝物 7（每人 2 颗、余 1）→ 火焰（第二次，塌方）。 */
export const TUTORIAL_ROUND2: readonly CardSpec[] = ["fire", 7, "fire"];

const ADVANCE: TutorialMove = { player: "", command: { type: "advance" } };
const me = (choice: "stay" | "leave"): TutorialMove => ({ player: TUTORIAL_SELF, command: { type: "decide", choice } });
const bot = (index: 0 | 1, choice: "stay" | "leave"): TutorialMove => ({
  player: TUTORIAL_BOTS[index].id,
  command: { type: "decide", choice },
});

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    kind: "info", id: "goal", lesson: "目标", anchor: "rounds",
    say: "一共探险 5 局，最后帐篷里宝石和神器分最多的人赢。",
    note: "每局大家一起走进神庙，一张张翻牌。我是咕噜嘎，带你走一遍。",
  },
  { kind: "watch", id: "enter", anchor: "path", say: "大家走进神庙，翻开第一张牌。", moves: [ADVANCE] },
  {
    kind: "info", id: "split", lesson: "宝物平分", anchor: "last-card",
    say: "宝物 11 颗，神庙里 3 个人平分：每人 3 颗。",
    note: "除不尽的 2 颗留在路上，谁也没拿到；所以同在神庙里的人，手上的宝石总是一样多。",
  },
  {
    kind: "info", id: "path-gems", anchor: "path-gems",
    say: "这是路上的余数宝石。",
    note: "之后有人回营地时，由回营地的人平分。",
  },
  {
    kind: "info", id: "hand", lesson: "手上和帐篷", anchor: "my-stats", face: "think",
    say: "你手上有 3 颗了，但还不安全。",
    note: "回营地才会存进帐篷。帐篷里的宝石永远不会丢，而且只有你自己看得到。",
  },
  {
    kind: "info", id: "choose", lesson: "同时选择", anchor: "choices",
    say: "每翻一张，神庙里的人同时选：继续挖，还是回营地。",
    note: "大家都选好了才一起亮出，看不到别人先选了什么；亮出之前随时能改。",
  },
  {
    kind: "do", id: "stay-1", anchor: "btn-stay", expect: me("stay"),
    say: "才刚开始，点「继续挖」。", note: "键盘按 1 也行。", noteTouch: "选好以后，等两个咕噜也选完。",
  },
  {
    kind: "watch", id: "reveal-1", anchor: "camp",
    say: "两个咕噜也选了继续挖，翻下一张。",
    moves: [bot(0, "stay"), bot(1, "stay"), ADVANCE],
  },
  {
    kind: "info", id: "hazard", lesson: "危险", anchor: "last-card", face: "think",
    say: "危险！火焰第一次出现，没事。",
    note: "同一种危险第二次出现就会塌方：那时还在神庙里的人，这局手上的宝石全丢。",
  },
  {
    kind: "info", id: "bust", lesson: "塌方的机会", anchor: "bust-chance", face: "think",
    say: "这里算好了下一张就塌方的机会。",
    note: "牌堆里还有 2 张火焰，所以是 7%。出过的危险越多，越该想想回营地。",
  },
  { kind: "do", id: "stay-2", anchor: "btn-stay", expect: me("stay"), say: "7% 还不高，继续挖。" },
  {
    kind: "watch", id: "reveal-2", anchor: "camp",
    say: "大家都继续，翻下一张。",
    moves: [bot(0, "stay"), bot(1, "stay"), ADVANCE],
  },
  {
    kind: "info", id: "artifact", lesson: "神器", anchor: "last-card",
    say: "神器！它躺在路上，还没人拿到。",
    note: "只有一个人单独回营地时才能带走它。整局第 1–3 件带出的神器各 5 分，第 4、5 件各 10 分。",
  },
  { kind: "do", id: "stay-3", anchor: "btn-stay", expect: me("stay"), say: "先继续挖，看看两个咕噜怎么选。" },
  { kind: "watch", id: "reveal-3", anchor: "camp", say: "两个咕噜在选……", moves: [bot(0, "leave"), bot(1, "leave")] },
  {
    kind: "info", id: "two-leave", lesson: "一起回营地", anchor: "camp", face: "surprised",
    say: "两个咕噜一起回营地了。",
    note: "路上的 2 颗由他俩平分，每人 1 颗，连同手上的存进帐篷；这一局他们不再回来。",
  },
  {
    kind: "info", id: "no-artifact", anchor: "last-card", face: "think",
    say: "两个人以上一起走，谁都拿不到神器。",
    note: "所以神器还躺在路上；这局结束时还没人拿走，它就作废了。",
  },
  { kind: "watch", id: "alone", anchor: "path", say: "神庙里只剩你，翻下一张。", moves: [ADVANCE] },
  {
    kind: "info", id: "solo-gems", anchor: "my-stats",
    say: "只剩你一个人，这 5 颗全归你。",
    note: "你手上现在有 3 + 5 = 8 颗。",
  },
  {
    kind: "do", id: "leave", lesson: "单独回营地", anchor: "btn-leave", expect: me("leave"), face: "think",
    say: "单独回营地就能带走神器：点「回营地」。",
    note: "这是整局第 1 件带出的神器，值 5 分。键盘按 2 也行。",
    noteTouch: "这是整局第 1 件带出的神器，值 5 分。",
  },
  {
    kind: "info", id: "stored", anchor: "my-tent-gems", face: "happy",
    say: "8 颗宝石存进帐篷，神器 5 分也到手了！",
    note: "别人帐篷里有多少看不到，想知道得自己记。",
  },
  { kind: "watch", id: "round-1-end", anchor: "round-summary", say: "大家都回营地了，第 1 局结束。", moves: [ADVANCE] },
  {
    kind: "watch", id: "round-2", anchor: "path", say: "第 2 局开始，翻第一张。",
    moves: [{ ...ADVANCE, top: TUTORIAL_ROUND2 }, ADVANCE],
  },
  {
    kind: "info", id: "first-hazard", lesson: "第一张是危险", anchor: "last-card",
    say: "第一张就是危险时不用选，直接翻下一张。",
    note: "不过它也算这局出现过一次了。",
  },
  { kind: "watch", id: "round-2-flip", anchor: "path", say: "翻下一张。", moves: [ADVANCE] },
  {
    kind: "do", id: "stay-4", anchor: "btn-stay", expect: me("stay"), face: "think",
    say: "火焰已经出现过了，这次冒个险：点「继续挖」。",
    note: "下一张塌方的机会是 7%。",
  },
  {
    kind: "watch", id: "reveal-4", anchor: "camp",
    say: "咕噜一号回营地了，你和咕噜二号接着挖……",
    moves: [bot(0, "leave"), bot(1, "stay"), ADVANCE],
  },
  {
    kind: "info", id: "collapse", lesson: "塌方", anchor: "last-card", face: "surprised",
    say: "火焰第二次出现，塌方了！",
    note: "你和咕噜二号这局手上的宝石全丢；先回营地的咕噜一号不受影响，帐篷里的也都还在。",
  },
  {
    kind: "info", id: "removed", lesson: "危险少一张", anchor: "hazards", face: "think",
    say: "塌方的那张火焰永久移出，之后几局火焰只剩 2 张。",
    note: "一局结束时，路上没人分的余数宝石也一起作废。",
  },
  { kind: "watch", id: "round-3", anchor: "path", say: "第 3 局开始。", moves: [ADVANCE] },
  {
    kind: "info", id: "deck-artifacts", lesson: "神器留到下局", anchor: "artifacts",
    say: "第 2 局的神器没翻出来，留在了牌堆里。",
    note: "每局再放进一件新的，所以这局牌堆里有 2 件，可能一局出好几件。",
  },
  {
    kind: "info", id: "scoring", lesson: "计分", anchor: "rounds",
    say: "5 局打完，帐篷宝石 + 神器分最多的人赢。",
    note: "同分比神器件数，再一样就并列获胜。",
  },
  {
    kind: "info", id: "auto", lesson: "托管", anchor: "btn-auto",
    say: "临时走开就点「托管」，人机替你选。",
    note: "超时没选算回营地；掉线时人机会替你代打，回来点「取消托管」。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！接着和两个咕噜打完这局。",
    note: "拿不准的时候点「提示」，我告诉你我会怎么选。",
  },
];

/** 教程开局：你和两个咕噜，第 1 局的牌序按剧本摆好。seed 只决定第 3 局以后的洗牌。 */
export function createTutorialGame(selfName: string, seed = Math.floor(Math.random() * 2 ** 32)): GameState {
  const game = createGame(
    [{ id: TUTORIAL_SELF, name: selfName }, ...TUTORIAL_BOTS.map((one) => ({ id: one.id, name: one.name }))],
    seed,
  );
  return stackDeck(game, TUTORIAL_ROUND1.map(parseCard));
}

/** 练习局「再练一局」：同样三个人，随机牌序。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame([{ id: TUTORIAL_SELF, name: selfName }, ...TUTORIAL_BOTS.map((one) => ({ id: one.id, name: one.name }))], seed);
}

/** 走一步（剧本和练习局都用）：命令交给 apply，自动推进交给 advance。不合法就抛错。 */
export function applyTutorialMove(state: GameState, move: TutorialMove): GameState {
  if (move.command.type === "advance") {
    const next = advance(state).state;
    const top = "top" in move ? move.top : undefined;
    return top ? stackDeck(next, top.map(parseCard)) : next;
  }
  return apply(state, move.player, move.command).state;
}

/** 两步是不是同一步（同一个人、同一种命令、同一个选择；不看 turn）。 */
export function sameMove(a: TutorialMove, b: TutorialMove): boolean {
  if (a.player !== b.player || a.command.type !== b.command.type) return false;
  if (a.command.type === "decide" && b.command.type === "decide") return a.command.choice === b.command.choice;
  return true;
}

/** 自动推进在练习局里的「行动者」名字（不是座位）。 */
export const AUTO_ACTOR = "auto";

/**
 * 练习局里现在等谁：自动阶段是 AUTO_ACTOR（到点推进）；决定阶段先轮到还没决定的咕噜，再轮到你；结束了返回 null。
 * 你已经决定了但咕噜还没决定时，返回那个咕噜（你还能改选或撤回，见 selfCanAct）。
 */
export function tutorialActor(state: GameState, self: string = TUTORIAL_SELF): string | null {
  if (state.phase === "gameOver") return null;
  if (isAutoPhase(state)) return AUTO_ACTOR;
  const pending = state.players.filter((player) => player.inTemple && !player.decided);
  return pending.find((player) => player.id !== self)?.id ?? (pending.some((player) => player.id === self) ? self : null);
}

/** 练习局里你现在能不能发命令（决定阶段、你还在神庙里：没决定可以选，决定了可以改选或撤回）。 */
export function selfCanAct(state: GameState, self: string = TUTORIAL_SELF): boolean {
  return state.phase === "decide" && state.players.some((player) => player.id === self && player.inTemple);
}

/** 练习局里自动阶段停多久（毫秒）：和服务器一样按阶段取 config.pauseMs。 */
export function autoPauseMs(state: GameState): number {
  const pause = state.config.pauseMs;
  switch (state.phase) {
    case "start":
      return pause.start;
    case "skip":
      return pause.skip;
    case "reveal":
      return state.events.some((event) => event.type === "PlayersLeft") ? pause.revealLeave : pause.reveal;
    case "roundEnd":
      return pause.roundEnd;
    default:
      return 0;
  }
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard / Table 的显示条件；按电脑尺寸算）。
 * viewer 是看界面的人（教程里就是你）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const self = state.players.find((player) => player.id === viewer);
  const over = state.phase === "gameOver";
  const lastIndex = state.path.length - 1;
  const lastCard: Card | undefined = state.path[lastIndex];
  switch (anchor) {
    case "rounds":
    case "turn":
    case "info-bar":
    case "hazards":
    case "deck":
    case "path-gems":
    case "bust-chance":
    case "path":
    case "camp":
    case "action-bar":
      return true;
    case "my-stats":
    case "my-tent":
    case "my-tent-gems":
      return !!self;
    case "artifacts":
      return !state.config.noArtifacts;
    case "last-card":
      return lastCard !== undefined;
    case "path-artifact":
      return state.path.some((card, index) => index !== lastIndex && card.kind === "artifact" && state.pathArtifacts.includes(card.artifact));
    case "next-card":
      return state.phase !== "roundEnd" && !over;
    case "round-summary":
      return state.phase === "roundEnd";
    case "choices":
    case "btn-stay":
    case "btn-leave":
      return state.phase === "decide" && !!self?.inTemple;
    case "btn-undo":
      return state.phase === "decide" && !!self?.inTemple && self.decided;
    case "btn-auto":
      return !!self && !over;
    default:
      return false;
  }
}

/** 剧本里某一步说的「塌方机会」和局面对得上（单测用）。 */
export function bustPercent(state: GameState): number {
  return Math.round(bustChance(state) * 100);
}
