/**
 * 预览局面工厂（对外接口）：界面的预览页、教程、验收（含背靠背的规则核对）都用它造局面，不用真打一局去等。
 *
 * - buildScene(spec)：按参数造任意一个精确局面。给出这一局翻过的牌和谁在第几张后离开，
 *   携带宝石、路径余数、帐篷、单独离开拿到的神器都按规则模拟出来（和真打出来的一样）；前几局的东西（帐篷、带出的神器、
 *   作废的神器、移出的危险）直接给。牌堆 = 这一局的完整牌堆减去路径上的牌，用种子洗好，deckTop 放在最上面。
 * - previewScene(name)：按名字造常见局面（开局、每种牌翻出后的决定、首张危险跳过、多件神器、单人拿神器、塌方、局末、终局含并列、超时……）。
 * - previewRoom(game, options)：把局面包成某个人收到的房间快照（LobbyRoomSnapshot，已经按他的视角脱敏），
 *   可以标出离线、人机、托管、倒计时、观战，给界面的预览页直接渲染牌桌。
 *
 * 返回的 GameState 是服务端的完整状态（含牌堆顺序）；要给某个视角看，先过 redactGameForViewer（previewRoom 已经做了）。
 */
import { cardLabel, parseCard, type CardSpec } from "./cards.js";
import {
  artifactValue,
  buildDeck,
  computeFinalResult,
  createGame,
  noneRemoved,
  redactGameForViewer,
  splitGems,
  timeoutTurn,
  timerMs,
} from "./engine.js";
import { createRng } from "./rng.js";
import { CAPACITY_OPTIONS, DEFAULT_ROOM_ACCESS, type Capacity, type LobbyMember, type LobbyRoomSnapshot } from "./roomTypes.js";
import {
  ARTIFACT_COUNT,
  DEFAULT_OPTIONS,
  HAZARD_COPIES,
  HAZARD_TYPES,
  ROUNDS,
  type Card,
  type Choice,
  type ClaimedArtifact,
  type Departure,
  type GameEvent,
  type GameOptions,
  type GameState,
  type HazardType,
  type Phase,
  type RoundResult,
} from "./types.js";

export type { CardSpec } from "./cards.js";

/** 预览里默认的玩家名字（座位 id 是 p1、p2……，和服务器一样）。 */
export const SCENE_NAMES_ZH = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛"] as const;

export interface SceneSpec {
  /** 人数（3–8，默认 4），或者名字列表；座位 id 依次是 p1、p2…… */
  readonly players?: number | readonly string[];
  /** 洗牌用的种子（默认 1）。 */
  readonly seed?: number;
  readonly options?: Partial<GameOptions>;
  /** 第几局（1–5，默认 1）。 */
  readonly round?: number;
  /**
   * 阶段。不给时自动判断：路径空 → start；第一张是危险且只翻了这一张 → skip；最后一张是第二次出现的危险 → roundEnd（塌方）；
   * 所有人都离开了 → reveal（刚离开的那一步）；否则 → decide。
   * 也可以指定：reveal（亮出最后一轮的选择）、roundEnd（所有人离开后的局末）、gameOver（第 5 局结束后）。
   */
  readonly phase?: Phase;
  /** 这一局已经翻出的牌（按顺序）。 */
  readonly path?: readonly CardSpec[];
  /** 这一局谁在第几张牌之后离开（1 = 第一张翻出后就走）。同一个数的人是同时离开的。没写的人还在神庙里。 */
  readonly leftAfter?: Readonly<Record<string, number>>;
  /** decide 阶段：已经决定了的人和他的选择（不能所有人都决定了，那样就该亮出了）。 */
  readonly choices?: Readonly<Record<string, Choice>>;
  /** 前几局攒下的帐篷宝石（默认 0）。这一局离开时存进去的会自动加上。 */
  readonly tentsBefore?: Readonly<Record<string, number>>;
  /** 前几局带出的神器，按带出顺序（第 1 件、第 2 件……）。round 不给时按神器编号算。 */
  readonly claimsBefore?: readonly { readonly player: string; readonly artifact: number; readonly round?: number }[];
  /** 前几局作废的神器编号。 */
  readonly lostBefore?: readonly number[];
  /** 这一局开始时每种危险已经移出几张（0–2，合计不超过已经打完的局数）。这一局塌方会自动再加 1。 */
  readonly removed?: Partial<Record<HazardType, number>>;
  /** 牌堆顶接下来要翻的牌（按顺序）。 */
  readonly deckTop?: readonly CardSpec[];
  /** 前几局的结果（只给界面显示用，默认空）。 */
  readonly history?: readonly RoundResult[];
  /** 直接改：帐篷最终值（会覆盖模拟结果，可能破坏守恒，慎用）。 */
  readonly tents?: Readonly<Record<string, number>>;
}

function fail(message: string): never {
  throw new Error(`buildScene：${message}`);
}

function sameCard(left: Card, right: Card): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "treasure") return left.gems === (right as typeof left).gems;
  if (left.kind === "hazard") return left.hazard === (right as typeof left).hazard;
  return left.artifact === 0 || (right as typeof left).artifact === 0 || left.artifact === (right as typeof left).artifact;
}

/** 从牌池里拿走一张（神器写 "artifact" 时拿编号最小的那件）。 */
function take(pool: Card[], wanted: Card, what: string): Card {
  const at = pool.findIndex((candidate) => sameCard(wanted, candidate));
  if (at < 0) fail(`${what}「${wanted.kind === "artifact" && wanted.artifact === 0 ? "神器" : cardLabel(wanted)}」在这一局的牌堆里没有（检查 removed / 神器编号 / 是否重复）`);
  return pool.splice(at, 1)[0]!;
}

/** 按参数造一个精确局面（见文件开头）。 */
export function buildScene(spec: SceneSpec = {}): GameState {
  const names = typeof spec.players === "object" ? [...spec.players] : SCENE_NAMES_ZH.slice(0, spec.players ?? 4);
  if (names.length < 3 || names.length > 8) fail("人数要在 3–8 之间");
  const ids = names.map((_, index) => `p${index + 1}`);
  const options: GameOptions = { ...DEFAULT_OPTIONS, ...spec.options };
  const seed = spec.seed ?? 1;
  const base = createGame(names.map((name, index) => ({ id: ids[index]!, name })), seed, options);
  const state = structuredClone(base);
  const round = spec.round ?? (spec.phase === "gameOver" ? ROUNDS : 1);
  if (!Number.isInteger(round) || round < 1 || round > ROUNDS) fail("round 要在 1–5 之间");
  const known = (id: string, what: string) => {
    if (!ids.includes(id)) fail(`${what} 里的 ${id} 不是座位 id（${ids.join("、")}）`);
  };

  // 前几局：移出的危险、带出的神器、作废的神器、帐篷
  // 终局（路径空）时前几局 = 全部 5 局；其他时候 = 这局之前的局。
  const finished = spec.phase === "gameOver" && (spec.path ?? []).length === 0;
  const roundsDone = finished ? ROUNDS : round - 1;
  const removed = { ...noneRemoved(), ...spec.removed };
  for (const hazard of HAZARD_TYPES) {
    if (!Number.isInteger(removed[hazard]) || removed[hazard] < 0 || removed[hazard] > 2) fail(`removed.${hazard} 要在 0–2 之间`);
  }
  if (HAZARD_TYPES.reduce((sum, hazard) => sum + removed[hazard], 0) > roundsDone) fail("移出的危险合计不能超过已经打完的局数（每局最多塌方一次）");
  const claimsBefore = spec.claimsBefore ?? [];
  const lostBefore = [...(spec.lostBefore ?? [])];
  const seenArtifacts = new Set<number>();
  for (const id of [...claimsBefore.map((claim) => claim.artifact), ...lostBefore]) {
    if (options.noArtifacts) fail("开了无神器，不能有神器");
    if (!Number.isInteger(id) || id < 1 || id > Math.min(roundsDone, ARTIFACT_COUNT)) fail(`前几局的神器编号 ${id} 不对（第 n 件神器第 n 局才放进来）`);
    if (seenArtifacts.has(id)) fail(`神器 ${id} 出现了两次`);
    seenArtifacts.add(id);
  }
  state.round = round;
  state.removed = removed;
  state.artifactsLost = lostBefore;
  state.artifactsClaimed = claimsBefore.length;
  state.turn = round * 100;
  state.history = [...(spec.history ?? [])];
  state.departures = [];
  for (const player of state.players) {
    player.tent = spec.tentsBefore?.[player.id] ?? 0;
    player.artifacts = [];
    player.inTemple = true;
    player.leftAfter = null;
    player.carried = 0;
    player.decided = false;
    player.choice = null;
  }
  for (const id of Object.keys(spec.tentsBefore ?? {})) known(id, "tentsBefore");
  claimsBefore.forEach((claim, index) => {
    known(claim.player, "claimsBefore");
    const order = index + 1;
    const claimRound = claim.round ?? claim.artifact;
    if (claimRound < claim.artifact || claimRound > roundsDone) fail(`神器 ${claim.artifact} 不可能在第 ${claimRound} 局带出`);
    const player = state.players.find((candidate) => candidate.id === claim.player)!;
    player.artifacts.push({ artifact: claim.artifact, order, value: artifactValue(order), round: claimRound });
  });

  // 这一局的牌堆：宝物 + 剩下的危险 + 还在牌堆里的神器（之前没翻出来的 + 这局新放的）
  const deckArtifactIds = options.noArtifacts
    ? []
    : Array.from({ length: Math.min(round, ARTIFACT_COUNT) }, (_, index) => index + 1).filter((id) => !seenArtifacts.has(id));
  const pool = buildDeck(removed, deckArtifactIds);
  const path = (spec.path ?? []).map((cardSpec) => take(pool, parseCard(cardSpec), "路径上的牌"));
  const rng = createRng(seed + round * 7919);
  let deck = rng.shuffle(pool);
  const top = (spec.deckTop ?? []).map((cardSpec) => take(deck, parseCard(cardSpec), "deckTop 里的牌"));
  deck = [...top, ...deck];

  // 模拟这一局
  const leftAfter = spec.leftAfter ?? {};
  for (const [id, after] of Object.entries(leftAfter)) {
    known(id, "leftAfter");
    if (!Number.isInteger(after) || after < 1 || after > path.length) fail(`${id} 的 leftAfter=${after} 要在 1–${path.length} 之间`);
  }
  const events: GameEvent[] = [];
  let collapsed: HazardType | null = null;
  let lastLeavers: string[] = [];
  let lastEvent: GameEvent | null = null;
  let lastLeave: (GameEvent & { type: "PlayersLeft" }) | null = null;
  let lastLeaveAfter = 0;
  for (let index = 0; index < path.length; index += 1) {
    const card = path[index]!;
    if (collapsed) fail("塌方之后不能再翻牌");
    const explorers = state.players.filter((player) => player.inTemple);
    if (explorers.length === 0) fail("神庙里已经没人了，不会再翻牌");
    const seen = card.kind === "hazard" && state.path.some((previous) => previous.kind === "hazard" && previous.hazard === card.hazard);
    state.path.push(card);
    if (card.kind === "treasure") {
      const { share, remainder } = splitGems(card.gems, explorers.length);
      for (const player of explorers) player.carried += share;
      state.pathGems += remainder;
      lastEvent = { type: "CardRevealed", card, index, inTemple: explorers.length, share, remainder, first: false };
    } else if (card.kind === "artifact") {
      state.pathArtifacts.push(card.artifact);
      lastEvent = { type: "CardRevealed", card, index, inTemple: explorers.length, share: 0, remainder: 0, first: false };
    } else {
      lastEvent = { type: "CardRevealed", card, index, inTemple: explorers.length, share: 0, remainder: 0, first: !seen };
      if (seen) collapsed = card.hazard;
    }
    const leavers = state.players.filter((player) => leftAfter[player.id] === index + 1);
    lastLeavers = leavers.map((player) => player.id);
    if (leavers.length === 0) continue;
    if (collapsed) fail("塌方的那张牌之后不能有人离开");
    if (index === 0 && card.kind === "hazard") fail("第一张是危险时不用决定（直接翻下一张），这时没人能离开");
    const pathGemsBefore = state.pathGems;
    const carried = leavers[0]!.carried;
    const { share, remainder } = splitGems(state.pathGems, leavers.length);
    state.pathGems = remainder;
    const claims: ClaimedArtifact[] = [];
    if (leavers.length === 1) {
      for (const artifact of state.pathArtifacts) {
        state.artifactsClaimed += 1;
        claims.push({ artifact, order: state.artifactsClaimed, value: artifactValue(state.artifactsClaimed), round });
      }
      state.pathArtifacts = [];
    }
    for (const player of leavers) {
      player.tent = (player.tent ?? 0) + player.carried + share;
      player.carried = 0;
      player.inTemple = false;
      player.leftAfter = index + 1;
      player.artifacts = [...player.artifacts, ...claims];
    }
    state.departures.push({ round, after: index + 1, players: lastLeavers, artifacts: claims } satisfies Departure);
    lastLeave = { type: "PlayersLeft", players: lastLeavers, carried, share, pathGemsBefore, pathGemsAfter: remainder, artifacts: claims };
    lastLeaveAfter = index + 1;
  }
  state.deck = deck;
  state.deckCount = deck.length;
  state.deckArtifacts = deck.filter((card) => card.kind === "artifact").length;
  state.rngState = rng.state;
  state.version = round * 100 + path.length;

  const explorers = state.players.filter((player) => player.inTemple);
  const justLeft = lastLeave && lastLeaveAfter === path.length ? lastLeave : null;
  // 自动判断阶段。最后一张牌之后有人离开，说明这一轮已经亮出了（还没翻下一张），只能是 reveal（所有人都走了还可以是局末）。
  let phase: Phase;
  let allowed: Phase[];
  if (collapsed) {
    phase = "roundEnd";
    allowed = ["roundEnd", "gameOver"];
  } else if (path.length === 0) {
    phase = "start";
    allowed = ["start", "gameOver"];
  } else if (explorers.length === 0) {
    phase = "reveal";
    allowed = ["reveal", "roundEnd", "gameOver"];
  } else if (justLeft) {
    phase = "reveal";
    allowed = ["reveal"];
  } else if (path.length === 1 && path[0]!.kind === "hazard") {
    phase = "skip";
    allowed = ["skip"];
  } else {
    phase = "decide";
    allowed = ["decide", "reveal"];
  }
  const wanted = spec.phase ?? phase;
  if (!allowed.includes(wanted)) fail(`这样的路径只能是 ${allowed.join(" / ")} 阶段，不能是 ${wanted}`);
  if (wanted === "gameOver" && round !== ROUNDS) fail("gameOver 只能在第 5 局");
  if (spec.choices && wanted !== "decide") fail("choices 只在 decide 阶段用");

  const endRound = (reason: RoundResult["reason"], hazard: HazardType | null, caught: string[], lostGems: number) => {
    const result: RoundResult = {
      round,
      reason,
      hazard,
      caught,
      lostGems,
      pathGemsDiscarded: state.pathGems,
      artifactsDiscarded: [...state.pathArtifacts],
      cards: path.length,
    };
    state.artifactsLost = [...state.artifactsLost, ...state.pathArtifacts];
    state.pathArtifacts = [];
    state.pathGems = 0;
    for (const player of state.players) {
      player.carried = 0;
      player.decided = false;
      player.choice = null;
    }
    state.history.push(result);
    state.phase = "roundEnd";
    events.push({ type: "RoundEnded", result });
  };

  if (phase === "roundEnd" && collapsed) {
    const caught = explorers.map((player) => player.id);
    const lostGems = explorers[0]?.carried ?? 0;
    state.removed = { ...state.removed, [collapsed]: state.removed[collapsed] + 1 };
    if (lastEvent) events.push(lastEvent);
    events.push({ type: "Collapse", hazard: collapsed, caught, lostGems, removedNow: state.removed[collapsed] });
    endRound("collapse", collapsed, caught, lostGems);
  } else if (wanted === "start" || (wanted === "gameOver" && path.length === 0)) {
    state.phase = "start";
    events.push({ type: "RoundStarted", round, deckCount: state.deckCount, deckArtifacts: state.deckArtifacts, newArtifact: options.noArtifacts ? null : round });
  } else if (wanted === "skip") {
    state.phase = "skip";
    if (lastEvent) events.push(lastEvent);
    events.push({ type: "FirstHazardSkipped", hazard: (path[0] as { hazard: HazardType }).hazard });
  } else if (wanted === "decide") {
    state.phase = "decide";
    state.turn = round * 100 + path.length;
    if (lastEvent) events.push(lastEvent);
    for (const [id, choice] of Object.entries(spec.choices ?? {})) {
      known(id, "choices");
      const player = state.players.find((candidate) => candidate.id === id)!;
      if (!player.inTemple) fail(`${id} 已经离开了，不用决定`);
      if (choice !== "stay" && choice !== "leave") fail(`${id} 的选择只能是 stay / leave`);
      player.decided = true;
      player.choice = choice;
      events.push({ type: "Decided", player: id });
    }
    if (explorers.every((player) => player.decided)) fail("所有人都决定了就该亮出了：用 phase: \"reveal\"，离开的人写进 leftAfter");
  } else {
    // reveal / 所有人离开后的 roundEnd / gameOver：先摆出最后一轮亮出的选择
    state.phase = "reveal";
    state.turn = round * 100 + path.length;
    const stay = explorers.map((player) => player.id);
    const leave = justLeft?.players ?? [];
    for (const player of state.players) {
      if (stay.includes(player.id)) {
        player.decided = true;
        player.choice = "stay";
      } else if (leave.includes(player.id)) {
        player.decided = true;
        player.choice = "leave";
      }
    }
    events.push({ type: "ChoicesRevealed", stay, leave: [...leave] });
    if (justLeft) events.push(justLeft);
    if (wanted === "roundEnd" || wanted === "gameOver") {
      if (explorers.length > 0) fail("还有人在神庙里，这一局还没结束");
      events.length = 0;
      endRound("allLeft", null, [], 0);
    }
  }

  if (wanted === "gameOver") {
    state.phase = "gameOver";
    events.length = 0;
    for (const player of state.players) {
      player.inTemple = false;
      player.decided = false;
      player.choice = null;
    }
  }
  for (const [id, tent] of Object.entries(spec.tents ?? {})) {
    known(id, "tents");
    state.players.find((player) => player.id === id)!.tent = tent;
  }
  if (wanted === "gameOver") {
    state.finalResult = computeFinalResult(state);
    events.push({ type: "GameEnded", result: state.finalResult });
  }
  state.events = events;
  return state;
}

/** 有名字的预览局面。 */
export const SCENES = {
  opening: { title: "第 1 局开局（路径空，马上翻第一张）", spec: { players: 4 } },
  treasure: { title: "翻出宝物 11：4 人每人 2 颗，路上余 3 颗，大家决定", spec: { players: 4, path: [11] } },
  hazard: { title: "翻出火焰（本局第一次出现，没事），大家决定", spec: { players: 4, path: [7, "fire"] } },
  artifact: { title: "翻出神器（放在路上），大家决定", spec: { players: 4, path: [5, "snake", "artifact"] } },
  deciding: {
    title: "决定中：甲选了继续、丙选了离开（别人只看到已决定），乙丁还没选",
    spec: { players: 4, path: [9, "fire", 4], choices: { p1: "stay", p3: "leave" } },
  },
  firstHazard: { title: "本局第一张就是危险：不用决定，直接翻下一张", spec: { players: 4, path: ["spider"] } },
  reveal: {
    title: "亮出：乙丁离开，平分路上 3 颗余数（各 1，剩 1）；甲丙继续",
    spec: { players: 4, path: [11, "mummy"], leftAfter: { p2: 2, p4: 2 } },
  },
  twoLeaveArtifact: {
    title: "两人同时离开：神器留在路上谁也拿不走",
    spec: { players: 4, path: [7, "artifact", 3], leftAfter: { p1: 3, p2: 3 } },
  },
  soloArtifact: {
    title: "第 4 局只有丙单独离开：一次拿走路上 2 件神器（第 3 件 5 分 + 第 4 件 10 分）",
    spec: {
      players: 4,
      round: 4,
      claimsBefore: [
        { player: "p1", artifact: 1 },
        { player: "p2", artifact: 2 },
      ],
      tentsBefore: { p1: 20, p2: 14, p3: 25, p4: 9 },
      path: [5, "A3", "rocks", "A4", 13],
      leftAfter: { p3: 5 },
      deckTop: ["rocks"],
    },
  },
  multiArtifact: {
    title: "第 2 局路上躺着 2 件神器（第 1 局没翻出来的那件留到了这局）",
    spec: {
      players: 5,
      round: 2,
      removed: { snake: 1 },
      tentsBefore: { p1: 12, p2: 7, p3: 0, p4: 15, p5: 4 },
      path: [14, "A1", "fire", "A2"],
    },
  },
  collapse: {
    title: "塌方：第二张火焰，还在里面的丙丁这局的宝石全丢；甲乙早就离开了",
    spec: { players: 4, path: [7, "fire", 11, 4, "fire"], leftAfter: { p1: 3, p2: 3 }, tentsBefore: { p1: 6, p3: 10 } },
  },
  allLeft: {
    title: "局末：所有人都离开了，路上的神器和余数作废",
    spec: { players: 3, path: [13, "artifact", "snake"], leftAfter: { p1: 3, p2: 3, p3: 3 }, phase: "roundEnd" },
  },
  lastRound: {
    title: "第 5 局（最后一局）决定中",
    spec: {
      players: 4,
      round: 5,
      removed: { fire: 1, snake: 1, mummy: 1 },
      claimsBefore: [
        { player: "p2", artifact: 1 },
        { player: "p4", artifact: 3, round: 3 },
      ],
      lostBefore: [2],
      tentsBefore: { p1: 31, p2: 24, p3: 40, p4: 28 },
      path: [15, "spider", "A4", 9, "rocks"],
    },
  },
  gameOver: {
    title: "终局：丙 40 分独胜",
    spec: {
      players: 4,
      phase: "gameOver",
      claimsBefore: [
        { player: "p1", artifact: 1 },
        { player: "p3", artifact: 2 },
        { player: "p4", artifact: 4 },
      ],
      tentsBefore: { p1: 23, p2: 30, p3: 35, p4: 18 },
    },
  },
  gameOverTieBreak: {
    title: "终局：甲乙同为 38 分，甲神器多 1 件获胜",
    spec: {
      players: 4,
      phase: "gameOver",
      claimsBefore: [
        { player: "p1", artifact: 2 },
        { player: "p2", artifact: 3 },
        { player: "p1", artifact: 4 },
      ],
      tentsBefore: { p1: 28, p2: 33, p3: 30, p4: 12 },
    },
  },
  gameOverShared: {
    title: "终局：乙丙总分、神器件数都一样，并列获胜",
    spec: {
      players: 3,
      phase: "gameOver",
      claimsBefore: [
        { player: "p2", artifact: 1 },
        { player: "p3", artifact: 2 },
      ],
      tentsBefore: { p1: 20, p2: 31, p3: 31 },
    },
  },
  noArtifacts: {
    title: "开了「无神器」：第 3 局，牌堆里没有神器",
    spec: { players: 4, round: 3, options: { noArtifacts: true }, removed: { spider: 1 }, path: [17, "mummy", 2] },
  },
  eightPlayers: {
    title: "8 人桌决定中",
    spec: { players: 8, path: [17, "rocks", 14], choices: { p2: "stay", p5: "leave", p7: "stay" } },
  },
  timeout: {
    title: "超时：乙丁没决定，按「离开」处理后亮出",
    build: () =>
      timeoutTurn(buildScene({ players: 4, path: [13, "spider", 5], choices: { p1: "stay", p3: "stay" } })),
  },
} satisfies Record<string, { title: string; spec?: SceneSpec; build?: () => GameState }>;

export type SceneName = keyof typeof SCENES;
export const SCENE_LIST = Object.keys(SCENES) as SceneName[];

/** 按名字造局面（服务端完整状态）。 */
export function previewScene(name: SceneName): GameState {
  const scene = SCENES[name] as { spec?: SceneSpec; build?: () => GameState };
  if (scene.build) return scene.build();
  return buildScene(scene.spec ?? {});
}

/** previewRoom 里座位 id 对应的连接 id（预览页冒充自己时用：Object.defineProperty(socket, "id", { value: previewSocketId("p1") })）。 */
export function previewSocketId(playerId: string): string {
  return playerId ? `sock-${playerId}` : "sock-spectator";
}

export interface PreviewRoomOptions {
  /** 从谁的座位看（座位 id，默认 p1）；"" 表示观战的人。 */
  readonly viewer?: string;
  /** 离线的座位。 */
  readonly offline?: readonly string[];
  /** 人机座位（名字会显示成原名，界面自己加「人机」标签）。 */
  readonly bots?: readonly string[];
  /** 托管中的座位。 */
  readonly auto?: readonly string[];
  /** 房主座位（默认 p1）。 */
  readonly host?: string;
  /** 倒计时剩余毫秒（默认：这一步的完整时限；传 null 表示不显示倒计时）。 */
  readonly turnRemainingMs?: number | null;
  /** 观战看帐篷（上帝视角）。 */
  readonly spectatorsSeeAll?: boolean;
  /** 观战的人的名字。 */
  readonly spectators?: readonly string[];
  /** 终局后的再来一局投票：已经同意的座位。 */
  readonly rematchAccepted?: readonly string[];
}

/** 把局面包成某个人收到的房间快照（已按他的视角脱敏）。 */
export function previewRoom(game: GameState, options: PreviewRoomOptions = {}): LobbyRoomSnapshot {
  const viewer = options.viewer ?? "p1";
  const host = options.host ?? game.players[0]!.id;
  const members: LobbyMember[] = game.players.map((player) => ({
    id: previewSocketId(player.id),
    playerId: player.id,
    name: player.name,
    isHost: player.id === host,
    connected: !(options.offline ?? []).includes(player.id),
    ...((options.bots ?? []).includes(player.id) ? { bot: true } : {}),
    ...((options.auto ?? []).includes(player.id) ? { auto: true } : {}),
  }));
  const spectators = [...(options.spectators ?? []), ...(viewer === "" ? ["观众"] : [])].map((name, index) => ({
    id: name === "观众" && viewer === "" ? previewSocketId("") : `sock-watch-${index}`,
    name,
  }));
  const capacity = (CAPACITY_OPTIONS as readonly number[]).includes(game.players.length) ? (game.players.length as Capacity) : 8;
  const remaining = options.turnRemainingMs === undefined ? (game.phase === "gameOver" ? undefined : timerMs(game)) : options.turnRemainingMs ?? undefined;
  const seeAll = viewer === "" && options.spectatorsSeeAll === true;
  return {
    code: "PREV1E",
    spectators,
    access: { ...DEFAULT_ROOM_ACCESS, spectatorsSeeAll: options.spectatorsSeeAll ?? false },
    capacity,
    options: { noArtifacts: game.config.noArtifacts },
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: redactGameForViewer(game, viewer, { seeAll }),
    ...(remaining !== undefined ? { turnRemainingMs: remaining } : {}),
    ...(game.phase === "gameOver"
      ? { rematch: { remainingMs: 60_000, acceptedIds: (options.rematchAccepted ?? []).map(previewSocketId) } }
      : {}),
  };
}

/** 检查一个服务端状态的配件守恒（测试和预览自检用）：返回发现的问题，空数组表示没问题。 */
export function checkConservation(state: GameState): string[] {
  const problems: string[] = [];
  const onPath = state.path;
  const inDeck = state.deck;
  const treasures = [...onPath, ...inDeck].filter((card) => card.kind === "treasure").map((card) => (card as { gems: number }).gems).sort((a, b) => a - b);
  if (state.phase !== "gameOver" && treasures.join(",") !== [1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17].join(",")) {
    problems.push(`宝物卡不对：${treasures.join(",")}`);
  }
  if (state.phase !== "gameOver") {
    const last = state.history.at(-1);
    for (const hazard of HAZARD_TYPES) {
      const count = [...onPath, ...inDeck].filter((card) => card.kind === "hazard" && card.hazard === hazard).length;
      let expected = HAZARD_COPIES - state.removed[hazard];
      // 塌方的那张还摆在路上（局末才收走），但已经算进 removed
      if (state.phase === "roundEnd" && last?.round === state.round && last.hazard === hazard) expected += 1;
      if (count !== expected) problems.push(`${hazard} 应有 ${expected} 张，实际 ${count} 张`);
    }
  }
  const claimed = state.players.flatMap((player) => player.artifacts.map((claim) => claim.artifact));
  const deckArtifacts = inDeck.filter((card) => card.kind === "artifact").map((card) => (card as { artifact: number }).artifact);
  const all = [...claimed, ...state.artifactsLost, ...state.pathArtifacts, ...deckArtifacts].sort((a, b) => a - b);
  const introduced = state.config.noArtifacts ? [] : Array.from({ length: Math.min(state.round, ARTIFACT_COUNT) }, (_, index) => index + 1);
  if (all.join(",") !== introduced.join(",")) problems.push(`神器不守恒：${all.join(",")}，应为 ${introduced.join(",")}`);
  if (deckArtifacts.length !== state.deckArtifacts) problems.push("deckArtifacts 和牌堆对不上");
  if (inDeck.length !== state.deckCount) problems.push("deckCount 和牌堆对不上");
  if (claimed.length !== state.artifactsClaimed) problems.push("artifactsClaimed 和玩家手里的神器对不上");
  const orders = state.players.flatMap((player) => player.artifacts.map((claim) => claim.order)).sort((a, b) => a - b);
  if (orders.join(",") !== Array.from({ length: orders.length }, (_, index) => index + 1).join(",")) problems.push("神器带出序号不连续");
  for (const player of state.players) {
    for (const claim of player.artifacts) {
      if (claim.value !== artifactValue(claim.order)) problems.push(`${player.id} 的神器分值不对`);
    }
  }
  const explorers = state.players.filter((player) => player.inTemple);
  if (state.phase !== "roundEnd" && state.phase !== "gameOver" && new Set(explorers.map((player) => player.carried)).size > 1) {
    problems.push("神庙里的人携带宝石不一样（S9）");
  }
  return problems;
}
