import { createRng, type Rng } from "./rng.js";
import {
  ARTIFACT_COUNT,
  AUTO_PHASES,
  DEFAULT_OPTIONS,
  HAZARD_COPIES,
  HAZARD_TYPES,
  ROUNDS,
  TREASURES,
  type Card,
  type Choice,
  type ClaimedArtifact,
  type Config,
  type FinalResult,
  type GameCommand,
  type GameEvent,
  type GameOptions,
  type GameState,
  type HazardType,
  type Player,
  type RoundResult,
  type ScoreLine,
} from "./types.js";

/** 人数范围（官方 3–8 人）。 */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export function defaultConfig(playerCount: number, options: Partial<GameOptions> = {}): Config {
  return {
    playerCount,
    rounds: ROUNDS,
    noArtifacts: options.noArtifacts ?? DEFAULT_OPTIONS.noArtifacts,
    decideTimeoutSec: 30,
    pauseMs: { start: 1500, skip: 2200, reveal: 1800, revealLeave: 3000, roundEnd: 5000 },
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/** 第 n 件被带出神庙的神器的分值：第 1–3 件 5 分，第 4–5 件 10 分（规则书 2.3，TC9）。 */
export function artifactValue(order: number): number {
  return order <= 3 ? 5 : 10;
}

/** 宝石在 n 个人之间平分：每人 share 颗，余 remainder 颗（规则书 4.1 / 4.2）。 */
export function splitGems(gems: number, people: number): { share: number; remainder: number } {
  if (people <= 0) return { share: 0, remainder: gems };
  const share = Math.floor(gems / people);
  return { share, remainder: gems - share * people };
}

export function noneRemoved(): Record<HazardType, number> {
  return { fire: 0, mummy: 0, rocks: 0, snake: 0, spider: 0 };
}

/**
 * 一局的牌堆（未洗）：15 张宝物 + 每种危险 3 − removed 张 + 神器。
 * artifacts 是神器 id 列表；给数字 k 表示 id 1..k（比如第 1 局 buildDeck(noneRemoved(), 1) 共 31 张，TC2）。
 */
export function buildDeck(removed: Readonly<Record<HazardType, number>>, artifacts: number | readonly number[] = []): Card[] {
  const ids = typeof artifacts === "number" ? Array.from({ length: artifacts }, (_, index) => index + 1) : [...artifacts];
  const deck: Card[] = TREASURES.map((gems) => ({ kind: "treasure", gems }));
  for (const hazard of HAZARD_TYPES) {
    const copies = HAZARD_COPIES - (removed[hazard] ?? 0);
    for (let copy = 0; copy < copies; copy += 1) deck.push({ kind: "hazard", hazard });
  }
  for (const artifact of ids) deck.push({ kind: "artifact", artifact });
  return deck;
}

function sameCard(left: Card, right: Card): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "treasure") return left.gems === (right as typeof left).gems;
  if (left.kind === "hazard") return left.hazard === (right as typeof left).hazard;
  return left.artifact === (right as typeof left).artifact;
}

function playerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

function inTemple(state: GameState): Player[] {
  return state.players.filter((player) => player.inTemple);
}

/** 这局开局时还在牌堆里的神器 id：已经放进来的（1..局数，无神器时没有）减去被带出的和作废的。 */
function artifactsStillInDeck(state: GameState, round: number): number[] {
  if (state.config.noArtifacts) return [];
  const gone = new Set<number>([...state.artifactsLost, ...state.players.flatMap((player) => player.artifacts.map((claim) => claim.artifact))]);
  return Array.from({ length: Math.min(round, ARTIFACT_COUNT) }, (_, index) => index + 1).filter((id) => !gone.has(id));
}

/** 开新的一局：所有人回到神庙入口，宝物全放回、剩下的危险放回、没翻出的神器留着、再放一件新神器（E1），洗牌。 */
function startRound(state: GameState, round: number, rng: Rng, events: GameEvent[]): void {
  state.round = round;
  state.phase = "start";
  state.path = [];
  state.pathGems = 0;
  state.pathArtifacts = [];
  for (const player of state.players) {
    player.inTemple = true;
    player.leftAfter = null;
    player.carried = 0;
    player.decided = false;
    player.choice = null;
  }
  const newArtifact = !state.config.noArtifacts && round <= ARTIFACT_COUNT ? round : null;
  const ids = artifactsStillInDeck(state, round);
  state.deck = rng.shuffle(buildDeck(state.removed, ids));
  state.deckCount = state.deck.length;
  state.deckArtifacts = ids.length;
  state.rngState = rng.state;
  events.push({ type: "RoundStarted", round, deckCount: state.deckCount, deckArtifacts: state.deckArtifacts, newArtifact });
}

/**
 * 开局：第 1 局的牌堆洗好，阶段 start（服务器停一下后 advance 翻第一张）。
 * 种子决定所有洗牌；同一种子、同一串操作总是同一局。
 */
export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  options: Partial<GameOptions> = {},
): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error(`需要 ${MIN_PLAYERS}–${MAX_PLAYERS} 位玩家才能开始。`);
  if (new Set(players.map((player) => player.id)).size !== players.length) throw new Error("玩家 id 重复。");
  const state: GameState = {
    config: defaultConfig(players.length, options),
    phase: "start",
    round: 0,
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      inTemple: true,
      leftAfter: null,
      carried: 0,
      tent: 0,
      artifacts: [],
      decided: false,
      choice: null,
    })),
    path: [],
    pathGems: 0,
    pathArtifacts: [],
    deckCount: 0,
    deckArtifacts: 0,
    removed: noneRemoved(),
    artifactsClaimed: 0,
    artifactsLost: [],
    turn: 0,
    departures: [],
    history: [],
    events: [],
    version: 0,
    deck: [],
    seed,
    log: [],
  };
  const events: GameEvent[] = [];
  startRound(state, 1, createRng(seed), events);
  state.events = events;
  return state;
}

/** 局末：路径余数作废（E4），路径上没人拿的神器作废（E3/E5），记下本局结果。 */
function endRound(
  state: GameState,
  reason: RoundResult["reason"],
  hazard: HazardType | null,
  caught: string[],
  lostGems: number,
  events: GameEvent[],
): void {
  const result: RoundResult = {
    round: state.round,
    reason,
    hazard,
    caught,
    lostGems,
    pathGemsDiscarded: state.pathGems,
    artifactsDiscarded: [...state.pathArtifacts],
    cards: state.path.length,
  };
  state.artifactsLost = [...state.artifactsLost, ...state.pathArtifacts];
  state.pathArtifacts = [];
  state.pathGems = 0;
  for (const player of state.players) {
    player.carried = 0;
    player.decided = false;
    player.choice = null;
  }
  state.history = [...state.history, result];
  state.phase = "roundEnd";
  events.push({ type: "RoundEnded", result });
}

/** 翻牌堆顶一张并结算（规则书 4.1）。 */
function flip(state: GameState, events: GameEvent[]): void {
  const card = state.deck.shift();
  if (!card) throw new Error("牌堆翻完了（按规则不会发生）。");
  state.deckCount = state.deck.length;
  const index = state.path.length;
  const seenBefore = card.kind === "hazard" && state.path.some((previous) => previous.kind === "hazard" && previous.hazard === card.hazard);
  state.path = [...state.path, card];
  for (const player of state.players) {
    player.decided = false;
    player.choice = null;
  }
  const explorers = inTemple(state);
  if (card.kind === "treasure") {
    const { share, remainder } = splitGems(card.gems, explorers.length);
    for (const player of explorers) player.carried += share;
    state.pathGems += remainder;
    events.push({ type: "CardRevealed", card, index, inTemple: explorers.length, share, remainder, first: false });
  } else if (card.kind === "artifact") {
    state.deckArtifacts -= 1;
    state.pathArtifacts = [...state.pathArtifacts, card.artifact];
    events.push({ type: "CardRevealed", card, index, inTemple: explorers.length, share: 0, remainder: 0, first: false });
  } else {
    events.push({ type: "CardRevealed", card, index, inTemple: explorers.length, share: 0, remainder: 0, first: !seenBefore });
    if (seenBefore) {
      // 第二次出现同一种危险：塌方。神庙里的人本局携带作废，这张危险永久移出。
      const caught = explorers.map((player) => player.id);
      const lostGems = explorers[0]?.carried ?? 0;
      state.removed = { ...state.removed, [card.hazard]: state.removed[card.hazard] + 1 };
      events.push({ type: "Collapse", hazard: card.hazard, caught, lostGems, removedNow: state.removed[card.hazard] });
      endRound(state, "collapse", card.hazard, caught, lostGems, events);
      return;
    }
    if (index === 0) {
      // E10：本局第一张就是危险，没人有理由离开，直接翻下一张。
      state.phase = "skip";
      events.push({ type: "FirstHazardSkipped", hazard: card.hazard });
      return;
    }
  }
  state.phase = "decide";
  state.turn += 1;
}

/** 全员决定后：亮出选择，离开的人平分路径余数、存进帐篷，单独离开的人拿走路径上所有神器（规则书 4.2）。 */
function resolveDecisions(state: GameState, events: GameEvent[]): void {
  const explorers = inTemple(state);
  const stay = explorers.filter((player) => player.choice === "stay").map((player) => player.id);
  const leavers = explorers.filter((player) => player.choice === "leave");
  events.push({ type: "ChoicesRevealed", stay, leave: leavers.map((player) => player.id) });
  state.phase = "reveal";
  if (leavers.length === 0) return;

  const pathGemsBefore = state.pathGems;
  const { share, remainder } = splitGems(pathGemsBefore, leavers.length);
  state.pathGems = remainder;
  const carried = leavers[0]!.carried;
  const claims: ClaimedArtifact[] = [];
  if (leavers.length === 1) {
    for (const artifact of state.pathArtifacts) {
      state.artifactsClaimed += 1;
      claims.push({ artifact, order: state.artifactsClaimed, value: artifactValue(state.artifactsClaimed), round: state.round });
    }
    state.pathArtifacts = [];
  }
  for (const player of leavers) {
    player.tent = (player.tent ?? 0) + player.carried + share;
    player.carried = 0;
    player.inTemple = false;
    player.leftAfter = state.path.length;
    if (claims.length > 0) player.artifacts = [...player.artifacts, ...claims];
  }
  const ids = leavers.map((player) => player.id);
  state.departures = [...state.departures, { round: state.round, after: state.path.length, players: ids, artifacts: claims }];
  events.push({ type: "PlayersLeft", players: ids, carried, share, pathGemsBefore, pathGemsAfter: remainder, artifacts: claims });
}

/** 总分 = 帐篷宝石 + 神器分。 */
export function scoreLine(player: Player): Omit<ScoreLine, "rank"> {
  const artifactPoints = player.artifacts.reduce((total, claim) => total + claim.value, 0);
  const gems = player.tent ?? 0;
  return { player: player.id, gems, artifacts: player.artifacts, artifactPoints, total: gems + artifactPoints };
}

/** 终局结算：总分最高者胜；同分比神器件数；再一样就并列获胜（规则书 6，待确认 #6）。 */
export function computeFinalResult(state: GameState): FinalResult {
  const lines = state.players.map(scoreLine);
  const better = (a: Omit<ScoreLine, "rank">, b: Omit<ScoreLine, "rank">) =>
    a.total > b.total || (a.total === b.total && a.artifacts.length > b.artifacts.length);
  const ranked: ScoreLine[] = lines.map((line) => ({ ...line, rank: 1 + lines.filter((other) => better(other, line)).length }));
  ranked.sort((a, b) => a.rank - b.rank || state.players.findIndex((p) => p.id === a.player) - state.players.findIndex((p) => p.id === b.player));
  return { scores: ranked, winners: ranked.filter((line) => line.rank === 1).map((line) => line.player) };
}

function resumeRng(state: GameState): Rng {
  return createRng(state.rngState ?? state.seed ?? 0);
}

/** 这个阶段由服务器到点自动推进（不等玩家）。 */
export function isAutoPhase(state: GameState): boolean {
  return AUTO_PHASES.includes(state.phase);
}

/**
 * 自动推进一步（服务器在 start / skip / reveal / roundEnd 阶段停顿到点后调用）：
 * - start / skip：翻下一张；
 * - reveal：神庙里还有人就翻下一张，没人了就结束本局；
 * - roundEnd：第 5 局之后结束对局，否则开下一局（洗牌用 rng，不给就接着状态里的种子随机数）。
 * 不修改传入的 state。
 */
export function advance(state: GameState, rng?: Rng): { state: GameState; events: GameEvent[] } {
  if (!isAutoPhase(state)) {
    throw new Error(state.phase === "decide" ? "还在等大家决定。" : "对局已经结束。");
  }
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  switch (next.phase) {
    case "start":
    case "skip":
      flip(next, events);
      break;
    case "reveal":
      for (const player of next.players) {
        player.decided = false;
        player.choice = null;
      }
      if (inTemple(next).length === 0) endRound(next, "allLeft", null, [], 0, events);
      else flip(next, events);
      break;
    case "roundEnd":
      if (next.round >= next.config.rounds) {
        next.phase = "gameOver";
        for (const player of next.players) {
          player.inTemple = false;
          player.decided = false;
          player.choice = null;
        }
        next.finalResult = computeFinalResult(next);
        events.push({ type: "GameEnded", result: next.finalResult });
      } else {
        startRound(next, next.round + 1, rng ?? resumeRng(next), events);
      }
      break;
    default:
      break;
  }
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

/**
 * 规则引擎主入口：玩家的命令（decide / undecide）。校验不过就抛错（错误信息是给玩家看的中文）。不修改传入的 state。
 * rng 只为接口统一（决定不涉及随机）。最后一个人决定后同一步里亮出选择、完成离开结算，阶段变成 reveal。
 */
export function apply(state: GameState, playerId: string, command: GameCommand, _rng?: Rng): { state: GameState; events: GameEvent[] } {
  if (state.phase === "gameOver") throw new Error("对局已经结束。");
  const me = playerIndex(state, playerId);
  if (me < 0) throw new Error("你不在这局里。");
  if (state.phase !== "decide") throw new Error("现在不用做决定，等下一张牌翻出来。");
  const type = (command as { type?: unknown } | null)?.type;
  if (type !== "decide" && type !== "undecide") throw new Error("未知的行动。");
  if (command.turn !== undefined && command.turn !== state.turn) throw new Error("这张牌的决定已经结束了。");
  if (!state.players[me]!.inTemple) throw new Error("你已经离开神庙了，这一局不用再决定。");

  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const player = next.players[me]!;
  if (command.type === "decide") {
    const choice: unknown = command.choice;
    if (choice !== "stay" && choice !== "leave") throw new Error("只能选「继续」或「离开」。");
    player.decided = true;
    player.choice = choice;
    events.push({ type: "Decided", player: playerId });
    if (inTemple(next).every((explorer) => explorer.decided)) resolveDecisions(next, events);
  } else {
    if (!player.decided) throw new Error("你还没有决定，不用撤回。");
    player.decided = false;
    player.choice = null;
    events.push({ type: "Undecided", player: playerId });
  }
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

/** 服务端用：执行命令并记进动作序列（同一种子重放这串动作就能复现整局）。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  const { state: next } = apply(state, playerId, command);
  next.log = [...(state.log ?? []), { player: playerId, command }];
  return next;
}

/** 服务端用：自动推进一步并记进动作序列。 */
export function advanceGame(state: GameState): GameState {
  const { state: next } = advance(state);
  next.log = [...(state.log ?? []), { player: "", command: { type: "ADVANCE" } }];
  return next;
}

/** 还在神庙里、这一轮还没决定的人（decide 阶段；其他阶段为空）。服务器按它安排倒计时和人机。 */
export function pendingDeciders(state: GameState): string[] {
  if (state.phase !== "decide") return [];
  return state.players.filter((player) => player.inTemple && !player.decided).map((player) => player.id);
}

/** 某个人超时时替他做的决定：离开（落袋为安，规则书 8.4）。 */
export function autoCommand(state: GameState, _playerId?: string): GameCommand {
  return { type: "decide", choice: "leave", turn: state.turn };
}

/**
 * 到点：
 * - decide：所有还没决定的人按「离开」处理（TimedOut 事件），然后亮出、结算；
 * - 自动阶段：同 advance；
 * - gameOver：原样返回。
 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "gameOver") return state;
  if (state.phase !== "decide") return advanceGame(state);
  const late = pendingDeciders(state);
  const next = structuredClone(state);
  const events: GameEvent[] = [{ type: "TimedOut", players: late }];
  for (const id of late) {
    const player = next.players[playerIndex(next, id)]!;
    player.decided = true;
    player.choice = "leave";
  }
  resolveDecisions(next, events);
  next.version += 1;
  next.events = events;
  next.log = [...(state.log ?? []), { player: "", command: { type: "TIMEOUT", players: late } }];
  return next;
}

/** 这个人现在能发的命令：没决定时 [继续, 离开]；决定了时 [撤回, 改成另一个]。别的时候为空。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase !== "decide") return [];
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player?.inTemple) return [];
  const turn = state.turn;
  if (!player.decided) {
    return [
      { type: "decide", choice: "stay", turn },
      { type: "decide", choice: "leave", turn },
    ];
  }
  // 自己的选择在自己的视角里一定看得到；万一是别人的视角（null），两种都给。
  const others: Choice[] = player.choice === "stay" ? ["leave"] : player.choice === "leave" ? ["stay"] : ["stay", "leave"];
  return [{ type: "undecide", turn }, ...others.map((choice): GameCommand => ({ type: "decide", choice, turn }))];
}

/** 服务器计时的 key：只在换步骤（新的决定轮、自动阶段）时变；别人的 decide / undecide 不改它，不会重置倒计时。 */
export function timerKey(state: GameState): string {
  return `${state.round}:${state.phase}:${state.turn}:${state.path.length}`;
}

/** 这一步的时限（毫秒）：决定 30 秒；自动阶段按 config.pauseMs。gameOver 为 0。 */
export function timerMs(state: GameState): number {
  const pause = state.config.pauseMs;
  switch (state.phase) {
    case "decide":
      return state.config.decideTimeoutSec * 1000;
    case "start":
      return pause.start;
    case "skip":
      return pause.skip;
    case "reveal":
      return state.players.some((player) => player.choice === "leave") ? pause.revealLeave : pause.reveal;
    case "roundEnd":
      return pause.roundEnd;
    default:
      return 0;
  }
}

export interface RedactOptions {
  /** 观战的上帝视角（房主开了「观战看帐篷」）：看得到所有人的帐篷宝石。决定中的选择照样看不到。 */
  readonly seeAll?: boolean;
}

/**
 * 发给某个人的视角（隐藏信息只从这里过滤）：
 * - 牌堆顺序（deck → 空数组，张数看 deckCount）、种子、随机数状态、动作序列：谁都拿不到；
 * - 别人的帐篷宝石：null（seeAll 或对局结束时公开）；
 * - 别人在决定中（decide）的选择：null，只公开「已决定 / 未决定」；亮出（reveal）后公开。
 * viewerId 传 "" 表示观战的人（没有自己的座位）。
 */
export function redactGameForViewer(state: GameState, viewerId: string, options: RedactOptions = {}): GameState {
  const { deck: _deck, seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  const showTents = options.seeAll === true || state.phase === "gameOver";
  const hideChoices = state.phase === "decide";
  const view = structuredClone(rest) as Omit<GameState, "deck" | "seed" | "rngState" | "log">;
  view.players = view.players.map((player) => ({
    ...player,
    tent: player.id === viewerId || showTents ? player.tent : null,
    choice: player.id === viewerId || !hideChoices ? player.choice : null,
  }));
  return { ...view, deck: [] };
}

/** 牌堆里还剩什么（只用公开信息推算，脱敏后的状态也能用）：界面显示「还剩几张、哪种危险还剩几张」，人机算概率。 */
export interface DeckInfo {
  readonly total: number;
  /** 还没翻出的宝物卡（宝石数）。 */
  readonly treasures: number[];
  readonly treasureGems: number;
  /** 每种危险还在牌堆里的张数。 */
  readonly hazards: Record<HazardType, number>;
  readonly artifacts: number;
}

export function deckInfo(state: GameState): DeckInfo {
  const removedAtStart = { ...state.removed };
  const last = state.history.at(-1);
  if (state.phase === "roundEnd" && last?.round === state.round && last.hazard) removedAtStart[last.hazard] -= 1;
  const treasures = [...TREASURES];
  const hazards = noneRemoved();
  for (const hazard of HAZARD_TYPES) hazards[hazard] = HAZARD_COPIES - removedAtStart[hazard];
  for (const card of state.path) {
    if (card.kind === "treasure") {
      const at = treasures.indexOf(card.gems);
      if (at >= 0) treasures.splice(at, 1);
    } else if (card.kind === "hazard") {
      hazards[card.hazard] -= 1;
    }
  }
  const total = treasures.length + HAZARD_TYPES.reduce((sum, hazard) => sum + hazards[hazard], 0) + state.deckArtifacts;
  return { total, treasures, treasureGems: treasures.reduce((sum, gems) => sum + gems, 0), hazards, artifacts: state.deckArtifacts };
}

/**
 * 下一张翻出来就塌方的概率（只用公开信息）：本局已经出现过的危险，牌堆里还剩几张 ÷ 牌堆张数。
 * 不在 decide / reveal / skip 阶段时为 0。
 */
export function bustChance(state: GameState): number {
  if (state.phase !== "decide" && state.phase !== "reveal" && state.phase !== "skip") return 0;
  const info = deckInfo(state);
  if (info.total === 0) return 0;
  const seen = new Set(state.path.flatMap((card) => (card.kind === "hazard" ? [card.hazard] : [])));
  let danger = 0;
  for (const hazard of seen) danger += info.hazards[hazard];
  return danger / info.total;
}

/**
 * 把指定的牌按顺序挪到牌堆顶（教程剧本、测试、预览用）：每张都要在牌堆里找得到，否则抛错。不改随机数状态。
 * 只对服务端状态有用（脱敏后的状态没有牌堆）。
 */
export function stackDeck(state: GameState, top: readonly Card[]): GameState {
  const next = structuredClone(state);
  const rest = [...next.deck];
  const picked: Card[] = [];
  for (const card of top) {
    const at = rest.findIndex((candidate) => sameCard(candidate, card));
    if (at < 0) throw new Error(`牌堆里没有这张牌：${JSON.stringify(card)}`);
    picked.push(rest.splice(at, 1)[0]!);
  }
  next.deck = [...picked, ...rest];
  return next;
}

/**
 * 让神庙里所有还没决定的人做决定（测试、教程、预览用）：choices 里没写的人按 fallback（默认继续）。
 * 最后一个人决定后进入 reveal。返回最终状态。
 */
export function decideAll(state: GameState, choices: Readonly<Record<string, Choice>> = {}, fallback: Choice = "stay"): GameState {
  let current = state;
  for (const id of pendingDeciders(state)) {
    current = apply(current, id, { type: "decide", choice: choices[id] ?? fallback }).state;
  }
  return current;
}

export { createRng };
