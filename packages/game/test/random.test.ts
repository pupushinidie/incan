import { describe, expect, it } from "vitest";
import {
  advance,
  apply,
  artifactValue,
  checkConservation,
  createGame,
  createRng,
  deckInfo,
  HAZARD_TYPES,
  isAutoPhase,
  legalActions,
  pendingDeciders,
  redactGameForViewer,
  timeoutTurn,
  timerKey,
  type GameState,
  type Rng,
} from "../src/index.js";

/**
 * 随机对局：每种人数（3–8）300 局标准规则 + 100 局「无神器」。随机走合法行动（偶尔改选、撤回、整轮超时）直到终局，
 * 每一步用普通代码查不变量，最后汇总成一次 expect（每步都 expect 太慢）。
 */
const GAMES_PER_COUNT = 300;
const NO_ARTIFACT_GAMES_PER_COUNT = 100;
const MAX_STEPS = 3000;

interface Tally {
  games: number;
  problems: string[];
  rounds: number;
  collapses: number;
  allLeft: number;
  firstHazardSkips: number;
  artifactsClaimed: number;
  multiArtifactPaths: number;
  multiClaims: number;
  ties: number;
  sharedWins: number;
  timeouts: number;
  maxRemoved: number;
  steps: number;
}

function newTally(): Tally {
  return {
    games: 0,
    problems: [],
    rounds: 0,
    collapses: 0,
    allLeft: 0,
    firstHazardSkips: 0,
    artifactsClaimed: 0,
    multiArtifactPaths: 0,
    multiClaims: 0,
    ties: 0,
    sharedWins: 0,
    timeouts: 0,
    maxRemoved: 0,
    steps: 0,
  };
}

const treasureGems = (state: GameState) => state.path.reduce((sum, card) => sum + (card.kind === "treasure" ? card.gems : 0), 0);
const tents = (state: GameState) => state.players.reduce((sum, player) => sum + (player.tent ?? 0), 0);

function playOne(playerCount: number, seed: number, noArtifacts: boolean, tally: Tally): void {
  const rng: Rng = createRng(seed * 7 + playerCount);
  const players = Array.from({ length: playerCount }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` }));
  let game = createGame(players, seed, { noArtifacts });
  // 每局一个「胆量」：离开的概率，探索从很保守到很冒险
  const leaveChance = 0.03 + rng.next() * 0.5;
  const problem = (message: string) => {
    if (tally.problems.length < 30) tally.problems.push(`${playerCount} 人 seed=${seed}${noArtifacts ? "（无神器）" : ""} 第 ${game.round} 局 ${game.phase}：${message}`);
  };
  // 每局开始时帐篷总数；本局作废的宝石（塌方丢掉的 + 局末余数）
  let tentsAtRoundStart = 0;
  let lostThisRound = 0;
  let steps = 0;
  let lastRound = game.round;

  while (game.phase !== "gameOver") {
    steps += 1;
    if (steps > MAX_STEPS) {
      problem("超过最大步数，可能卡死");
      break;
    }
    const before = game;
    let next: GameState;
    if (game.phase === "decide") {
      const pending = pendingDeciders(game);
      if (pending.length === 0) {
        problem("decide 阶段却没人要决定（卡死）");
        break;
      }
      for (const id of pending) {
        if (legalActions(game, id).length !== 2) problem(`${id} 没决定却没有两个合法行动`);
      }
      if (rng.next() < 0.03) {
        next = timeoutTurn(game);
        tally.timeouts += 1;
      } else {
        // 偶尔让已经决定的人改选或撤回
        const decided = game.players.filter((player) => player.inTemple && player.decided);
        if (decided.length > 0 && rng.next() < 0.1) {
          const who = decided[rng.int(decided.length)]!;
          const actions = legalActions(game, who.id);
          next = apply(game, who.id, actions[rng.int(actions.length)]!).state;
          if (timerKey(next) !== timerKey(game)) problem("改选 / 撤回改了计时 key");
        } else {
          const who = pending[rng.int(pending.length)]!;
          next = apply(game, who, { type: "decide", choice: rng.next() < leaveChance ? "leave" : "stay", turn: game.turn }).state;
          if (next.phase === "decide" && timerKey(next) !== timerKey(game)) problem("别人决定改了计时 key");
        }
      }
    } else if (isAutoPhase(game)) {
      next = advance(game).state;
    } else {
      problem(`未知阶段 ${game.phase}`);
      break;
    }
    if (next.version !== before.version + 1) problem("version 没有正好 +1");
    game = next;

    // ---- 不变量 ----
    for (const message of checkConservation(game)) problem(message);
    const events = game.events.map((event) => event.type);
    if (events.includes("FirstHazardSkipped")) tally.firstHazardSkips += 1;
    if (game.round !== lastRound) {
      if (game.round !== lastRound + 1) problem("局数跳了");
      lastRound = game.round;
      tentsAtRoundStart = tents(game);
      lostThisRound = 0;
      if (game.pathGems !== 0 || game.path.length !== 0) problem("新的一局路径没清空");
      if (!game.players.every((player) => player.inTemple && player.carried === 0 && player.leftAfter === null)) problem("新的一局有人不在入口");
    }
    for (const event of game.events) {
      if (event.type === "Collapse") lostThisRound += event.lostGems * event.caught.length;
      if (event.type === "RoundEnded") lostThisRound += event.result.pathGemsDiscarded;
      if (event.type === "PlayersLeft" && event.artifacts.length > 1) tally.multiClaims += 1;
    }
    // 宝石守恒：本局翻出的宝物 = 新存进帐篷的 + 神庙里的人携带的 + 路径余数 + 作废的
    const carried = game.players.reduce((sum, player) => sum + player.carried, 0);
    if (game.phase !== "gameOver" && treasureGems(game) !== tents(game) - tentsAtRoundStart + carried + game.pathGems + lostThisRound) {
      problem(`宝石不守恒：翻出 ${treasureGems(game)}，帐篷 +${tents(game) - tentsAtRoundStart}，携带 ${carried}，路径 ${game.pathGems}，作废 ${lostThisRound}`);
    }
    if (game.players.some((player) => player.carried < 0 || (player.tent ?? 0) < 0) || game.pathGems < 0) problem("出现负数");
    if (game.players.some((player) => !player.inTemple && player.carried !== 0)) problem("离开的人还带着宝石");
    if (HAZARD_TYPES.some((hazard) => game.removed[hazard] > 2)) problem("同一种危险移出超过 2 张");
    if (HAZARD_TYPES.reduce((sum, hazard) => sum + game.removed[hazard], 0) > game.history.filter((result) => result.reason === "collapse").length) {
      problem("移出的危险比塌方次数多");
    }
    if (game.pathArtifacts.length > 1) tally.multiArtifactPaths += 1;
    if (game.phase === "decide") {
      if (pendingDeciders(game).length === 0) problem("decide 阶段没人要决定");
      if (!game.players.some((player) => player.inTemple)) problem("decide 阶段神庙里没人");
    }
    if ((game.phase === "skip") !== events.includes("FirstHazardSkipped")) problem("skip 阶段和 FirstHazardSkipped 事件对不上");
    if (game.phase === "skip" && game.path.length !== 1) problem("skip 不是在第一张");
    // 视角：随便挑一个人，看不到牌堆、种子、别人的帐篷和决定中的选择；公开信息推算的牌堆张数对得上
    const viewer = game.players[rng.int(game.players.length)]!.id;
    const view = redactGameForViewer(game, viewer);
    if (view.deck.length !== 0 || view.seed !== undefined || view.rngState !== undefined || view.log !== undefined) problem("脱敏后还有服务端字段");
    if (game.phase !== "gameOver" && view.players.some((player) => player.id !== viewer && player.tent !== null)) problem("看得到别人的帐篷");
    if (game.phase === "decide" && view.players.some((player) => player.id !== viewer && player.choice !== null)) problem("决定中看得到别人的选择");
    if (game.phase !== "roundEnd" && game.phase !== "gameOver" && deckInfo(view).total !== game.deck.length) problem("公开推算的牌堆张数不对");
  }
  tally.steps += steps;
  tally.games += 1;
  tally.rounds += game.history.length;
  tally.collapses += game.history.filter((result) => result.reason === "collapse").length;
  tally.allLeft += game.history.filter((result) => result.reason === "allLeft").length;
  tally.maxRemoved = Math.max(tally.maxRemoved, ...HAZARD_TYPES.map((hazard) => game.removed[hazard]));
  // ---- 终局 ----
  if (game.phase !== "gameOver") return;
  if (game.history.length !== 5 || game.round !== 5) problem("没打满 5 局就结束了");
  const result = game.finalResult;
  if (!result) {
    problem("终局没有结果");
    return;
  }
  tally.artifactsClaimed += game.artifactsClaimed;
  if (noArtifacts && game.artifactsClaimed + game.artifactsLost.length > 0) problem("无神器却出现了神器");
  for (const line of result.scores) {
    const player = game.players.find((candidate) => candidate.id === line.player)!;
    const points = player.artifacts.reduce((sum, claim) => sum + artifactValue(claim.order), 0);
    if (line.gems !== player.tent || line.artifactPoints !== points || line.total !== (player.tent ?? 0) + points) problem(`${line.player} 的总分不对`);
  }
  const best = Math.max(...result.scores.map((line) => line.total));
  const top = result.scores.filter((line) => line.total === best);
  const mostArtifacts = Math.max(...top.map((line) => line.artifacts.length));
  const expectedWinners = top.filter((line) => line.artifacts.length === mostArtifacts).map((line) => line.player).sort();
  if (JSON.stringify([...result.winners].sort()) !== JSON.stringify(expectedWinners)) problem("胜者判定不对");
  if (top.length > 1) tally.ties += 1;
  if (result.winners.length > 1) tally.sharedWins += 1;
}

describe("随机对局", () => {
  for (let playerCount = 3; playerCount <= 8; playerCount += 1) {
    it(`${playerCount} 人：${GAMES_PER_COUNT} 局标准 + ${NO_ARTIFACT_GAMES_PER_COUNT} 局无神器，不变量始终成立、都能打完`, () => {
      const tally = newTally();
      for (let index = 0; index < GAMES_PER_COUNT; index += 1) playOne(playerCount, 1000 + index, false, tally);
      for (let index = 0; index < NO_ARTIFACT_GAMES_PER_COUNT; index += 1) playOne(playerCount, 5000 + index, true, tally);
      console.log(
        `${playerCount} 人 ${tally.games} 局：平均 ${(tally.steps / tally.games).toFixed(0)} 步；塌方 ${tally.collapses} 局、全员离开 ${tally.allLeft} 局；` +
          `首张危险跳过 ${tally.firstHazardSkips} 次；带出神器 ${tally.artifactsClaimed} 件，一次拿多件 ${tally.multiClaims} 次，路上同时 ≥2 件 ${tally.multiArtifactPaths} 步；` +
          `总分并列 ${tally.ties} 局、并列获胜 ${tally.sharedWins} 局；整轮超时 ${tally.timeouts} 次；单种危险最多移出 ${tally.maxRemoved} 张`,
      );
      expect(tally.problems).toEqual([]);
      expect(tally.games).toBe(GAMES_PER_COUNT + NO_ARTIFACT_GAMES_PER_COUNT);
      expect(tally.rounds).toBe(tally.games * 5);
      // 覆盖面：这些情况在几百局里都该出现过
      expect(tally.collapses).toBeGreaterThan(0);
      expect(tally.allLeft).toBeGreaterThan(0);
      expect(tally.firstHazardSkips).toBeGreaterThan(0);
      expect(tally.artifactsClaimed).toBeGreaterThan(0);
      expect(tally.timeouts).toBeGreaterThan(0);
    }, 120_000);
  }
});
