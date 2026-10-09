import { describe, expect, it } from "vitest";
import {
  advance,
  apply,
  BOT_NOISE,
  BOT_RHO_MAX,
  BOT_RHO_MIN,
  botAdvice,
  botCommand,
  botPersonality,
  buildScene,
  createGame,
  HINT_RHO,
  isAutoPhase,
  legalActions,
  pendingDeciders,
  redactGameForViewer,
  type BotAdvice,
  type GameState,
  type SceneSpec,
} from "../src/index.js";
import { carryAtLeast, match, mine, play, random, twoHazards } from "./bot-sim.js";

/** 补充 1.7 用的「标准账」：ρ=1、不加扰动、不按比分调整。 */
const FLAT = { rho: 1, noise: false, scoreAdjust: false } as const;

function adviceAt(spec: SceneSpec, options = {}, seat = "p1"): BotAdvice {
  const game = buildScene(spec);
  expect(game.phase).toBe("decide");
  const advice = botAdvice(redactGameForViewer(game, seat), seat, options);
  expect(advice).not.toBeNull();
  return advice!;
}

/** 人机实际可能用到的 ρ：性格 [0.7, 1.8] × 扰动 ±15%（比分调整只会更大胆，单独测）。 */
const RHO_SPAN = [BOT_RHO_MIN * (1 - BOT_NOISE), 1, HINT_RHO, BOT_RHO_MAX * (1 + BOT_NOISE)];

function choiceFor(spec: SceneSpec, rho: number) {
  return adviceAt(spec, { rho, noise: false, scoreAdjust: false }).choice;
}

/** 跑一局，每个决定点交给 visit（拿到完整状态和座位）；返回终局状态。 */
function walk(players: number, seed: number, visit: (state: GameState, id: string) => void): GameState {
  let state = createGame(Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` })), seed);
  let steps = 0;
  while (state.phase !== "gameOver") {
    steps += 1;
    if (steps > 1500) throw new Error("步数太多");
    if (isAutoPhase(state)) {
      state = advance(state).state;
      continue;
    }
    for (const id of pendingDeciders(state)) {
      visit(state, id);
      state = apply(state, id, botCommand(redactGameForViewer(state, id), id)!).state;
    }
  }
  return state;
}

describe("人机只看自己座位的视角", () => {
  it("隐藏信息（牌堆顺序、种子、别人的帐篷、别人这一轮的选择）怎么改都不影响人机的决定", () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      walk(4 + (seed % 3), seed, (state, id) => {
        const view = redactGameForViewer(state, id);
        expect(view.deck).toEqual([]);
        expect(view.seed).toBeUndefined();
        expect(view.rngState).toBeUndefined();
        for (const other of view.players) if (other.id !== id) expect(other.tent).toBeNull();
        const base = botAdvice(view, id);
        // 改隐藏信息：牌堆倒过来、种子换掉、别人帐篷乱填、别人改选
        const tampered = structuredClone(state);
        tampered.deck = [...tampered.deck].reverse();
        tampered.seed = (tampered.seed ?? 0) + 12345;
        tampered.rngState = 99;
        for (const other of tampered.players) {
          if (other.id === id) continue;
          other.tent = (other.tent ?? 0) + 37;
          if (other.decided) other.choice = other.choice === "stay" ? "leave" : "stay";
        }
        expect(botAdvice(redactGameForViewer(tampered, id), id)).toEqual(base);
        // 直接拿完整状态来调用，也会先按这个座位脱敏，结果一样
        expect(botAdvice(state, id)).toEqual(base);
        expect(botCommand(view, id)).toEqual(base!.command);
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("不用它决定时返回 null：不在决定阶段、已经离开、已经决定过", () => {
    const start = buildScene({ players: 3 });
    expect(start.phase).toBe("start");
    expect(botCommand(redactGameForViewer(start, "p1"), "p1")).toBeNull();
    const left = buildScene({ players: 3, path: [5, 9], leftAfter: { p1: 1 } });
    expect(botCommand(redactGameForViewer(left, "p1"), "p1")).toBeNull();
    expect(botAdvice(redactGameForViewer(left, "p1"), "p1")).toBeNull();
    const decided = buildScene({ players: 3, path: [5, 9], choices: { p1: "stay" } });
    expect(botCommand(redactGameForViewer(decided, "p1"), "p1")).toBeNull();
    // 提示按钮：已经决定了也照样给建议
    expect(botAdvice(redactGameForViewer(decided, "p1"), "p1", { hint: true })?.choice).toBe("stay");
    const over = buildScene({ players: 3, phase: "gameOver" });
    expect(botCommand(redactGameForViewer(over, "p1"), "p1")).toBeNull();
  });
});

describe("补充 1.7 关键局面 B1–B10", () => {
  const B: Record<string, SceneSpec> = {
    B1: { players: 4, path: ["fire", 11] },
    B2: { players: 4, path: ["fire", "snake", "mummy", 5, 7] },
    B3: { players: 3, path: ["fire", 17, "snake", 14, "mummy", 13, "spider"] },
    B4: { players: 3, path: [9, "fire", 4, "snake", 11], leftAfter: { p2: 4, p3: 4 } },
    // 规则书里是 2 人从头一起走；本站最少 3 人，这里让第三个人在宝物 3 之后先走（c=1、p=0，神器 5 分）
    B5: { players: 3, path: ["fire", 3, "A1", "snake"], leftAfter: { p3: 2 } },
    B6: { players: 4, round: 3, removed: { fire: 1, snake: 1 }, lostBefore: [1, 2], path: ["fire", 7, "snake", 2] },
    B7: { players: 5, path: ["fire", "snake", "mummy", "rocks", "spider", 2] },
    B8: {
      players: 3,
      round: 4,
      claimsBefore: [
        { player: "p2", artifact: 1 },
        { player: "p2", artifact: 2 },
        { player: "p3", artifact: 3 },
      ],
      path: [5, "A4", "rocks"],
    },
  };

  it("B1：4 人，火焰、宝物 11 → 塌方 2/29，现在走值 3.5，任何性格都继续", () => {
    const advice = adviceAt(B.B1!, FLAT);
    expect(advice.analysis.bust).toBeCloseTo(2 / 29, 6);
    expect(advice.analysis.carried).toBe(2);
    expect(advice.analysis.pathGems).toBe(3);
    expect(advice.analysis.leaveValue).toBeCloseTo(3.5, 6);
    expect(advice.analysis.deckCount).toBe(29);
    for (const rho of RHO_SPAN) expect(choiceFor(B.B1!, rho)).toBe("stay");
    expect(advice.reason).toContain("7%");
    expect(advice.reason).toContain("手里 2 颗");
  });

  it("B2：4 人，三种危险 → 看性格：ρ=1.0 离开，ρ=1.5 继续（ρ 真的起作用）", () => {
    const advice = adviceAt(B.B2!, FLAT);
    expect(advice.analysis.bust).toBeCloseTo(6 / 26, 6);
    expect(advice.analysis.leaveValue).toBeCloseTo(4, 6);
    expect(advice.choice).toBe("leave");
    expect(choiceFor(B.B2!, 1.5)).toBe("stay");
    expect(advice.analysis.criticalRho).toBeGreaterThan(1);
    expect(advice.analysis.criticalRho).toBeLessThan(1.5);
    expect(advice.reason).toContain("3 种危险");
  });

  it("B3：3 人，手里 13 颗、四种危险 → 任何性格都离开", () => {
    const advice = adviceAt(B.B3!, FLAT);
    expect(advice.analysis.carried).toBe(13);
    expect(advice.analysis.pathGems).toBe(5);
    expect(advice.analysis.bust).toBeCloseTo(8 / 24, 6);
    for (const rho of [...RHO_SPAN, BOT_RHO_MAX * (1 + BOT_NOISE) * 2]) expect(choiceFor(B.B3!, rho)).toBe("leave");
    expect(advice.reason).toContain("4 种危险");
    expect(advice.reason).toContain("手里 13 颗");
    expect(advice.reason).toContain("帐篷");
  });

  it("B4：只剩自己一个人，宝物全归自己 → 继续（不按人数平分去算）", () => {
    const advice = adviceAt(B.B4!, FLAT);
    expect(advice.analysis.inTemple).toBe(1);
    expect(advice.analysis.carried).toBe(15);
    expect(advice.analysis.leaveValue).toBeCloseTo(16, 6); // 一个人走余数全拿
    expect(advice.analysis.gain).toBeCloseTo(105 / 26, 6); // 剩下 12 张宝物共 105 颗、26 张牌
    expect(advice.choice).toBe("stay");
    for (const rho of RHO_SPAN.slice(1)) expect(choiceFor(B.B4!, rho)).toBe("stay");
    expect(advice.reason).toContain("只剩你一个人");
  });

  it("B5：2 人在神庙、路上 5 分神器 → 还早，继续", () => {
    const advice = adviceAt(B.B5!, FLAT);
    expect(advice.analysis.inTemple).toBe(2);
    expect(advice.analysis.artifactPoints).toBe(5);
    expect(advice.analysis.bust).toBeCloseTo(4 / 27, 6);
    for (const rho of RHO_SPAN) expect(choiceFor(B.B5!, rho)).toBe("stay");
  });

  it("B6：第 3 局，火焰、蛇各被移出过 1 张 → 塌方 2/25，继续（记得永久移出的危险）", () => {
    const advice = adviceAt(B.B6!, FLAT);
    expect(advice.analysis.bust).toBeCloseTo(2 / 25, 6);
    expect(advice.analysis.deckCount).toBe(25);
    for (const rho of RHO_SPAN) expect(choiceFor(B.B6!, rho)).toBe("stay");
  });

  it("B7：5 人，五种危险全出过、手里 0 颗 → 几乎没东西可丢，继续", () => {
    const advice = adviceAt(B.B7!, FLAT);
    expect(advice.analysis.bust).toBeCloseTo(10 / 25, 6);
    expect(advice.analysis.leaveValue).toBeCloseTo(1, 6);
    for (const rho of RHO_SPAN) expect(choiceFor(B.B7!, rho)).toBe("stay");
    expect(advice.analysis.rule).toBe("tiny");
  });

  it("B8：已带出 3 件神器，路上第 4 件值 10 分 → 还早，继续（神器按带出序号算分）", () => {
    const advice = adviceAt(B.B8!, FLAT);
    expect(advice.analysis.artifactPoints).toBe(10);
    expect(advice.analysis.bust).toBeCloseTo(2 / 28, 6);
    expect(advice.analysis.leaveValue).toBeCloseTo(1 + 1 + 10 * 0.25, 6);
    for (const rho of RHO_SPAN) expect(choiceFor(B.B8!, rho)).toBe("stay");
  });

  it("B9：手里 0 颗、路上没余数没神器 → 一律继续（硬规则 1）", () => {
    const spec: SceneSpec = { players: 4, path: ["fire", "snake"] };
    const advice = adviceAt(spec, FLAT);
    expect(advice.analysis.leaveValue).toBe(0);
    expect(advice.analysis.rule).toBe("empty");
    for (const rho of [0.01, ...RHO_SPAN]) expect(choiceFor(spec, rho)).toBe("stay");
  });

  it("B10：本局第一张就是危险 → 引擎直接翻下一张，人机不用决定", () => {
    const game = buildScene({ players: 4, path: ["fire"] });
    expect(game.phase).toBe("skip");
    expect(botCommand(redactGameForViewer(game, "p1"), "p1")).toBeNull();
  });

  it("下一张不可能塌方时一律继续（硬规则 3）：危险都只剩最后一张", () => {
    // 第 3 局火焰、蛇各被移出 2 张：这局它们只剩 1 张，出现后不会再塌方
    const spec: SceneSpec = { players: 3, round: 5, removed: { fire: 2, snake: 2 }, path: [15, "fire", "snake", 13] };
    const advice = adviceAt(spec, FLAT);
    expect(advice.analysis.bust).toBe(0);
    expect(advice.analysis.carried).toBeGreaterThan(8);
    expect(advice.choice).toBe("stay");
    expect(advice.analysis.rule).toBe("safe");
    expect(advice.reason).toContain("不可能塌方");
  });

  it("只剩自己、路上有神器而且已经很危险 → 离开并拿走神器（神器按 100% 计入）", () => {
    const spec: SceneSpec = { players: 3, path: [3, "A1", "fire", "snake", "mummy", 15, "rocks"], leftAfter: { p2: 2, p3: 2 } };
    const advice = adviceAt(spec, FLAT);
    expect(advice.analysis.inTemple).toBe(1);
    expect(advice.analysis.artifactPoints).toBe(5);
    expect(advice.analysis.leaveValue).toBeCloseTo(advice.analysis.carried + advice.analysis.pathGems + 5, 6);
    for (const rho of RHO_SPAN) expect(choiceFor(spec, rho)).toBe("leave");
    expect(advice.reason).toBe("只剩你一个人，现在离开能带走路上的 5 分的神器，连同 16 颗宝石。");
  });
});

describe("性格和扰动", () => {
  it("同一桌的性格都在 [0.7, 1.8] 里而且两两拉开（3–8 人，各种名字）", () => {
    for (let seats = 3; seats <= 8; seats += 1) {
      for (let variant = 0; variant < 60; variant += 1) {
        const game = createGame(
          Array.from({ length: seats }, (_, i) => ({ id: `p${i + 1}`, name: i === 0 ? `真人${variant}` : `咕噜${i}号` })),
          variant,
        );
        const rhos = game.players.map((player) => botPersonality(game, player.id)).sort((a, b) => a - b);
        expect(rhos[0]!).toBeGreaterThanOrEqual(BOT_RHO_MIN);
        expect(rhos.at(-1)!).toBeLessThanOrEqual(BOT_RHO_MAX);
        const slot = (BOT_RHO_MAX - BOT_RHO_MIN) / seats;
        for (let i = 1; i < rhos.length; i += 1) expect(rhos[i]! - rhos[i - 1]!).toBeGreaterThanOrEqual(0.4 * slot - 1e-9);
      }
    }
  });

  it("同一局面结果可复现；扰动只在 ±15% 以内，不同的牌会变", () => {
    const game = buildScene({ players: 4, path: ["fire", 11, "snake", 4] });
    const view = redactGameForViewer(game, "p2");
    const a = botAdvice(view, "p2")!;
    expect(botAdvice(structuredClone(view), "p2")).toEqual(a);
    const base = botPersonality(view, "p2");
    const seen = new Set<string>();
    for (const tail of [4, 5, 7, 9, 11, 13, 14, 15]) {
      const other = buildScene({ players: 4, path: ["fire", 11, "snake", tail === 11 ? 1 : tail] });
      const rho = botAdvice(redactGameForViewer(other, "p2"), "p2", { scoreAdjust: false })!.analysis.rho;
      expect(rho).toBeGreaterThanOrEqual(base * (1 - BOT_NOISE) - 1e-9);
      expect(rho).toBeLessThanOrEqual(base * (1 + BOT_NOISE) + 1e-9);
      seen.add(rho.toFixed(6));
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  it("提示模式：ρ=1.3、不加扰动，谁的座位都一样", () => {
    const game = buildScene({ players: 4, path: ["fire", 11, "snake", 4] });
    const hints = game.players.map((player) => botAdvice(redactGameForViewer(game, player.id), player.id, { hint: true })!);
    for (const hint of hints) {
      expect(hint.analysis.rho).toBe(HINT_RHO);
      expect(hint.choice).toBe(hints[0]!.choice);
      expect(hint.reason).toBe(hints[0]!.reason);
    }
  });

  it("最后一局：这一局别人带回多少按公开的路径精确重放；落后超过 10 分时更大胆", () => {
    // 第 5 局，乙在 17、15 之后单独离开：17/3=5 余 2，15/3=5 余 0 → 乙带回 5+5+2=12 颗；之前大家都是 0
    const spec: SceneSpec = { players: 3, round: 5, path: [17, 15, "fire", 4], leftAfter: { p2: 2 } };
    const adjusted = adviceAt(spec, { noise: false });
    expect(adjusted.analysis.behind).toBe(12);
    const plain = adviceAt(spec, { noise: false, scoreAdjust: false });
    expect(adjusted.analysis.rho / plain.analysis.rho).toBeCloseTo(1 + 12 / 40, 6);
    // 前几局不调
    const early = adviceAt({ ...spec, round: 3 }, { noise: false });
    expect(early.analysis.behind).toBe(0);
  });
});

describe("理由文案", () => {
  it("每一步都有一句通顺的理由，和选择对得上；也不犯补充 1.9 的蠢错", () => {
    let leaves = 0;
    let stays = 0;
    for (let seed = 100; seed < 160; seed += 1) {
      walk(3 + (seed % 6), seed, (state, id) => {
        const advice = botAdvice(redactGameForViewer(state, id), id)!;
        expect(advice.reason.length).toBeGreaterThan(10);
        expect(advice.reason.length).toBeLessThanOrEqual(60);
        expect(advice.reason).not.toMatch(/undefined|NaN|Infinity|null/);
        if (advice.choice === "leave") {
          leaves += 1;
          expect(advice.reason).toMatch(/帐篷|神器/);
          // 蠢错 2：手里没东西还离开
          expect(advice.analysis.leaveValue).toBeGreaterThan(1);
          // 不可能塌方时不离开
          expect(advice.analysis.bust).toBeGreaterThan(0);
        } else {
          stays += 1;
          expect(advice.reason).toMatch(/继续/);
        }
      });
    }
    expect(leaves).toBeGreaterThan(100);
    expect(stays).toBeGreaterThan(100);
  });

  it("理由例子（补充 1.10 的口气）", () => {
    const stay = adviceAt({ players: 4, path: ["fire", 11] }, FLAT).reason;
    expect(stay).toBe("下一张塌方的机会约 7%，手里 2 颗，再挖一张平均能多拿 0.8 颗，值得继续。");
    const leave = adviceAt({ players: 3, path: ["fire", 17, "snake", 14, "mummy", 13, "spider"] }, FLAT).reason;
    expect(leave).toBe("已经出了 4 种危险，下一张有 33% 的机会全丢；手里 13 颗，还能分路上的 5 颗余数，先带回帐篷。");
    const grab = adviceAt({ players: 3, path: [3, "A1", "fire", "snake", "mummy", "rocks", 15], leftAfter: { p3: 1 } }, FLAT);
    expect(grab.choice).toBe("leave");
    expect(grab.reason).toBe("只剩你和另一个人，现在单独走能拿走 5 分的神器（两人一起走就谁都拿不到）。");
  });
});

describe("自对弈和强度", () => {
  it("3–8 人全人机各 300 局：每一步都合法、不超过最大步数、决策够快", { timeout: 120_000 }, () => {
    const times: number[] = [];
    for (let seats = 3; seats <= 8; seats += 1) {
      for (let i = 0; i < 300; i += 1) {
        const result = play(Array(seats).fill(mine), 7_000 + seats * 1_000 + i, Array(seats).fill(true), i % 10 === 9);
        expect(result.steps).toBeLessThan(1500);
        times.push(...result.times);
      }
    }
    const mean = times.reduce((sum, value) => sum + value, 0) / times.length;
    expect(mean).toBeLessThan(50);
    expect(times.reduce((max, value) => Math.max(max, value), 0)).toBeLessThan(300);
  });

  it("每一步发出去的命令都在 legalActions 里（带当前 turn）", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      walk(5, 900 + seed, (state, id) => {
        const command = botCommand(redactGameForViewer(state, id), id)!;
        expect(legalActions(state, id)).toContainEqual(command);
      });
    }
  });

  it("一桌人机不会总是一起走：神庙里还有 ≥3 人时全体同时离开的比例很低", () => {
    let groups = 0;
    let together = 0;
    for (let i = 0; i < 200; i += 1) {
      const result = play(Array(5).fill(mine), 31_000 + i);
      for (const group of result.groups) {
        if (group.of < 3) continue;
        groups += 1;
        if (group.size === group.of) together += 1;
      }
    }
    expect(together / groups).toBeLessThan(0.2);
  });

  it("强度底线（300 局，座位轮换）：对随机 ≥ 88%，对两个简单基线明显高于均分", { timeout: 60_000 }, () => {
    for (const seats of [3, 4, 5]) {
      expect(match(mine, random, 300, seats).win).toBeGreaterThanOrEqual(0.88);
      expect(match(mine, carryAtLeast(12), 300, seats).win).toBeGreaterThan(0.75);
      expect(match(mine, twoHazards, 300, seats).win).toBeGreaterThan(0.75);
    }
  });
});
