/**
 * 印加宝藏人机模拟：npx tsx packages/game/test/bot-sim.ts [每组局数=600] [组=all|self|vs|variants]
 *
 * - self：3–8 人全人机自对弈（每种人数 N 局），每一步都查合法、最大步数断言、决策耗时、一起离开的比例。
 * - vs：1 个人机对 n−1 个基线（随机 / 携带 ≥12 就走 / 出现两种危险就走），3/4/5/8 人桌，座位轮换。
 * - variants：几个对照（不加噪声的 ρ=1 一桌、固定 ρ 对一桌人机等），给调参用。
 *
 * 胜率里并列获胜按 1/并列人数 计。只用规则包的公开接口；人机只拿 redactGameForViewer 之后的状态。
 */
import {
  advance,
  apply,
  botAdvice,
  botCommand,
  createGame,
  createRng,
  isAutoPhase,
  legalActions,
  pendingDeciders,
  redactGameForViewer,
  type BotOptions,
  type Choice,
  type GameState,
  type Rng,
} from "../src/index.js";

export type Strategy = (view: GameState, playerId: string, rng: Rng) => Choice;

const MAX_STEPS = 1500;

/** 人机（服务器上的样子）。 */
export const mine: Strategy = (view, id) => {
  const command = botCommand(view, id);
  if (!command || command.type !== "decide") throw new Error("人机该决定时没给命令");
  return command.choice;
};
export const mineWith =
  (options: BotOptions): Strategy =>
  (view, id) =>
    botAdvice(view, id, options)!.choice;
/** 基线 1：随机 50% 继续 / 50% 离开。 */
export const random: Strategy = (_view, _id, rng) => (rng.next() < 0.5 ? "stay" : "leave");
/** 基线 2：携带 ≥ t 就走。 */
export const carryAtLeast =
  (t: number): Strategy =>
  (view, id) =>
    view.players.find((player) => player.id === id)!.carried >= t ? "leave" : "stay";
/** 基线 3：本局出现 ≥2 种危险、并且现在离开拿得到东西就走。 */
export const twoHazards: Strategy = (view, id) => {
  const kinds = new Set(view.path.flatMap((card) => (card.kind === "hazard" ? [card.hazard] : [])));
  const me = view.players.find((player) => player.id === id)!;
  const something = me.carried > 0 || view.pathGems > 0 || view.pathArtifacts.length > 0;
  return kinds.size >= 2 && something ? "leave" : "stay";
};

export interface GameStats {
  readonly winners: number[];
  readonly scores: number[];
  readonly ranks: number[];
  readonly steps: number;
  /** 人机（被计时的座位）每次决策耗时（毫秒）。 */
  readonly times: number[];
  /** 离开记录：每批几个人、当时神庙里几个人。 */
  readonly groups: { size: number; of: number }[];
}

export function play(strategies: Strategy[], seed: number, timed: boolean[] = [], noArtifacts = false): GameStats {
  const n = strategies.length;
  let state = createGame(
    strategies.map((_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` })),
    seed,
    { noArtifacts },
  );
  const rng = createRng(seed ^ 0x9e3779b9);
  const times: number[] = [];
  let steps = 0;
  while (state.phase !== "gameOver") {
    steps += 1;
    if (steps > MAX_STEPS) throw new Error(`超过 ${MAX_STEPS} 步还没结束（种子 ${seed}）`);
    if (isAutoPhase(state)) {
      state = advance(state).state;
      continue;
    }
    const pending = pendingDeciders(state);
    if (pending.length === 0) throw new Error(`决定阶段没人要决定（种子 ${seed}）`);
    for (const id of pending) {
      const seat = Number(id.slice(1)) - 1;
      const view = redactGameForViewer(state, id);
      const t0 = timed[seat] ? performance.now() : 0;
      const choice = strategies[seat]!(view, id, rng);
      if (timed[seat]) times.push(performance.now() - t0);
      const command = { type: "decide" as const, choice, turn: state.turn };
      const legal = legalActions(state, id).some((action) => action.type === "decide" && action.choice === choice && action.turn === state.turn);
      if (!legal) throw new Error(`不合法的命令 ${JSON.stringify(command)}（种子 ${seed}）`);
      state = apply(state, id, command).state;
    }
  }
  const result = state.finalResult!;
  const index = (id: string) => Number(id.slice(1)) - 1;
  const scores = Array<number>(n).fill(0);
  const ranks = Array<number>(n).fill(0);
  for (const line of result.scores) {
    scores[index(line.player)] = line.total;
    ranks[index(line.player)] = line.rank;
  }
  // 离开分批：每批人数和当时神庙里的人数
  const groups: { size: number; of: number }[] = [];
  const inTempleByRound = new Map<number, number>();
  for (const departure of state.departures) {
    const before = inTempleByRound.get(departure.round) ?? n;
    groups.push({ size: departure.players.length, of: before });
    inTempleByRound.set(departure.round, before - departure.players.length);
  }
  return { winners: result.winners.map(index), scores, ranks, steps, times, groups };
}

export interface MatchResult {
  readonly win: number;
  readonly fair: number;
  readonly avgRank: number;
  readonly avgScore: number;
  readonly baseScore: number;
}

/** 1 个 a 对 seats−1 个 b，a 轮流坐每个座位。 */
export function match(a: Strategy, b: Strategy, games: number, seats: number, seed0 = 1000): MatchResult {
  let win = 0;
  let rank = 0;
  let score = 0;
  let base = 0;
  for (let i = 0; i < games; i += 1) {
    const seat = i % seats;
    const strategies = Array.from({ length: seats }, (_, k) => (k === seat ? a : b));
    const result = play(strategies, seed0 + i);
    if (result.winners.includes(seat)) win += 1 / result.winners.length;
    rank += result.ranks[seat]!;
    score += result.scores[seat]!;
    base += (result.scores.reduce((sum, value) => sum + value, 0) - result.scores[seat]!) / (seats - 1);
  }
  return { win: win / games, fair: 1 / seats, avgRank: rank / games, avgScore: score / games, baseScore: base / games };
}

function pct(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

function selfPlay(games: number): void {
  console.log(`\n## 全人机自对弈（每种人数 ${games} 局，最大步数断言 ${MAX_STEPS}）`);
  for (let seats = 3; seats <= 8; seats += 1) {
    const times: number[] = [];
    let maxSteps = 0;
    let solo = 0;
    let multi = 0;
    let everyone = 0;
    let total = 0;
    let scoreSum = 0;
    const t0 = performance.now();
    for (let i = 0; i < games; i += 1) {
      const result = play(Array(seats).fill(mine), 50_000 + seats * 10_000 + i, Array(seats).fill(true), i % 10 === 9);
      times.push(...result.times);
      maxSteps = Math.max(maxSteps, result.steps);
      scoreSum += result.scores.reduce((sum, value) => sum + value, 0) / seats;
      for (const group of result.groups) {
        total += 1;
        if (group.size === 1) solo += 1;
        else multi += 1;
        if (group.size === group.of && group.of >= 2) everyone += 1;
      }
    }
    times.sort((x, y) => x - y);
    const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
    console.log(
      `${seats} 人：${games} 局全合法，最多 ${maxSteps} 步；决策 ${times.length} 次，平均 ${mean.toFixed(3)} ms，p99 ${quantile(times, 0.99).toFixed(3)} ms，最慢 ${times.at(-1)!.toFixed(2)} ms；` +
        `离开 ${total} 批：单独 ${pct(solo / total)}、多人一起 ${pct(multi / total)}、神庙里所有人一起 ${pct(everyone / total)}；人均 ${(scoreSum / games).toFixed(1)} 分；` +
        `${((performance.now() - t0) / games).toFixed(1)} ms/局`,
    );
  }
}

function versus(games: number): void {
  console.log(`\n## 1 个人机 对 n−1 个基线（每组 ${games} 局，座位轮换）`);
  const baselines: [string, Strategy][] = [
    ["随机", random],
    ["携带≥12就走", carryAtLeast(12)],
    ["两种危险就走", twoHazards],
  ];
  for (const seats of [3, 4, 5, 8]) {
    for (const [name, baseline] of baselines) {
      const r = match(mine, baseline, games, seats);
      console.log(
        `${seats} 人桌 对 ${name}：胜率 ${pct(r.win)}（均分 ${pct(r.fair)}），平均名次 ${r.avgRank.toFixed(2)}，人机均分 ${r.avgScore.toFixed(1)} / 基线均分 ${r.baseScore.toFixed(1)}`,
      );
    }
  }
}

function variants(games: number): void {
  console.log(`\n## 对照（每组 ${games} 局）`);
  const flat = mineWith({ rho: 1, noise: false, scoreAdjust: false });
  const noisy1 = mineWith({ rho: 1, scoreAdjust: false });
  for (const seats of [3, 4, 5]) {
    const r = match(flat, noisy1, games, seats);
    console.log(`${seats} 人：ρ=1 不加噪声 对 一桌 ρ=1 加噪声：${pct(r.win)}（均分 ${pct(r.fair)}）`);
    const s = match(mine, noisy1, games, seats);
    console.log(`${seats} 人：人机（性格分档）对 一桌 ρ=1 加噪声：${pct(s.win)}`);
    const t = match(mineWith({ scoreAdjust: false }), mine, games, seats);
    console.log(`${seats} 人：不按比分调整 对 一桌人机：${pct(t.win)}`);
    for (const rho of [0.8, 1.0, 1.4, 1.8, 2.2]) {
      const u = match(mineWith({ rho }), mine, games, seats);
      console.log(`${seats} 人：固定 ρ=${rho} 对 一桌人机：${pct(u.win)}，均分 ${u.avgScore.toFixed(1)} / ${u.baseScore.toFixed(1)}`);
    }
    const h = match(mineWith({ hint: true }), mine, games, seats);
    console.log(`${seats} 人：提示模式（ρ=1.3 不加噪声）对 一桌人机：${pct(h.win)}`);
  }
  // 基线互相比，确认基线本身不是太弱
  for (const seats of [3, 5]) {
    const r = match(carryAtLeast(12), random, games, seats);
    const s = match(twoHazards, random, games, seats);
    console.log(`${seats} 人：携带≥12就走 对 随机 ${pct(r.win)}；两种危险就走 对 随机 ${pct(s.win)}`);
  }
}

/** 调参用：两个版本分别对三个基线、再互相打。 */
function compare(games: number, a: BotOptions, b: BotOptions, label: string): void {
  console.log(`\n## 对比 ${label}（每组 ${games} 局）`);
  const A = mineWith(a);
  const B = mineWith(b);
  for (const seats of [3, 4, 5, 8]) {
    const row: string[] = [];
    for (const [name, base] of [["随机", random], ["≥12", carryAtLeast(12)], ["两危险", twoHazards]] as [string, Strategy][]) {
      row.push(`${name} ${pct(match(A, base, games, seats).win)}/${pct(match(B, base, games, seats).win)}`);
    }
    const ab = match(A, B, games, seats);
    const ba = match(B, A, games, seats);
    console.log(`${seats} 人：${row.join("，")}；A 进 B 桌 ${pct(ab.win)}，B 进 A 桌 ${pct(ba.win)}（均分 ${pct(ab.fair)}）`);
  }
}

const isMain = process.argv[1]?.endsWith("bot-sim.ts");
if (isMain) {
  const games = Number(process.argv[2] ?? 600);
  const group = process.argv[3] ?? "all";
  const t0 = performance.now();
  if (group === "all" || group === "self") selfPlay(games);
  if (group === "all" || group === "vs") versus(games);
  if (group === "variants") variants(games);
  if (group === "opp") compare(games, {}, { opponentModel: false }, "A=估计别人 / B=原始公式");
  if (group === "score") compare(games, {}, { scoreAdjust: false }, "A=按比分调 / B=不调");
  console.log(`\n用时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
}
