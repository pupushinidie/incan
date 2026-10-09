import { describe, expect, it } from "vitest";
import {
  advance,
  apply,
  artifactValue,
  buildDeck,
  buildScene,
  bustChance,
  computeFinalResult,
  createGame,
  deckInfo,
  HAZARD_TYPES,
  noneRemoved,
  scoreLine,
  stackDeck,
  TREASURES,
  type GameState,
} from "../src/index.js";
import { parseCard } from "../src/cards.js";
import { decide, P3, P4, player, stacked, step } from "./helpers.js";

/** 牌堆里某种危险有几张。 */
function hazardsInDeck(state: GameState, hazard: string): number {
  return state.deck.filter((card) => card.kind === "hazard" && card.hazard === hazard).length;
}

describe("规则书第 9 节测试用例", () => {
  it("规则书 TC1 宝物卡构成：15 张，面值 1,2,3,4,5,5,7,7,9,11,11,13,14,15,17，合计 124", () => {
    expect([...TREASURES]).toEqual([1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17]);
    expect(TREASURES).toHaveLength(15);
    expect(TREASURES.reduce((sum, gems) => sum + gems, 0)).toBe(124);
  });

  it("规则书 TC2 危险卡构成：5 种 × 3 张；第 1 局 buildDeck 长度 15+15+1=31", () => {
    expect(HAZARD_TYPES).toEqual(["fire", "mummy", "rocks", "snake", "spider"]);
    const deck = buildDeck(noneRemoved(), 1);
    expect(deck).toHaveLength(31);
    for (const hazard of HAZARD_TYPES) {
      expect(deck.filter((card) => card.kind === "hazard" && card.hazard === hazard)).toHaveLength(3);
    }
    expect(deck.filter((card) => card.kind === "treasure")).toHaveLength(15);
    expect(deck.filter((card) => card.kind === "artifact")).toHaveLength(1);
    // 真开局也是 31 张
    expect(createGame(P4, 1).deck).toHaveLength(31);
    expect(createGame(P4, 1).deckCount).toBe(31);
  });

  it("规则书 TC3 宝物平分 + 余数：4 人在神庙翻出 11 → 每人 +2，路径 +3", () => {
    const game = step(stacked(P4, [11]));
    expect(game.phase).toBe("decide");
    expect(game.players.map((p) => p.carried)).toEqual([2, 2, 2, 2]);
    expect(game.pathGems).toBe(3);
    expect(game.events).toContainEqual(expect.objectContaining({ type: "CardRevealed", share: 2, remainder: 3, inTemple: 4 }));
  });

  it("规则书 TC4 离开分余数：路径 3 颗，2 人同时离开 → 每人 +1，路径剩 1", () => {
    let game = step(stacked(P4, [11]));
    game = decide(game, { a: "leave", b: "leave" });
    expect(game.phase).toBe("reveal");
    expect(player(game, "a").tent).toBe(2 + 1);
    expect(player(game, "b").tent).toBe(2 + 1);
    expect(game.pathGems).toBe(1);
    expect(game.events).toContainEqual(
      expect.objectContaining({ type: "PlayersLeft", players: ["a", "b"], share: 1, carried: 2, pathGemsBefore: 3, pathGemsAfter: 1 }),
    );
  });

  it("规则书 TC5 单人离开拿神器：之前没人带出过神器，甲单独离开拿到第 1 件（5 分）", () => {
    let game = step(stacked(P4, [5, "A1"]));
    game = step(decide(game));
    expect(game.pathArtifacts).toEqual([1]);
    expect(game.artifactsClaimed).toBe(0);
    game = decide(game, { a: "leave" });
    expect(player(game, "a").artifacts).toEqual([{ artifact: 1, order: 1, value: 5, round: 1 }]);
    expect(game.pathArtifacts).toEqual([]);
    expect(game.artifactsClaimed).toBe(1);
    // 宝石：携带 1 + 路径余数 1（单独离开拿全部）
    expect(player(game, "a").tent).toBe(2);
  });

  it("规则书 TC6 多人离开神器不动：甲乙同时离开，神器留在路径上；丙丁继续", () => {
    let game = step(stacked(P4, [5, "A1"]));
    game = step(decide(game));
    game = decide(game, { a: "leave", b: "leave" });
    expect(game.pathArtifacts).toEqual([1]);
    expect(player(game, "a").artifacts).toEqual([]);
    expect(player(game, "b").artifacts).toEqual([]);
    expect(player(game, "c").inTemple).toBe(true);
    expect(player(game, "d").inTemple).toBe(true);
    game = step(game);
    expect(game.phase).toBe("decide");
  });

  it("规则书 TC7 第二次同种危险 → 塌方：携带清零、火焰永久移出、路径神器作废；第 2 局火焰 2 张、牌堆 15+14+1=30", () => {
    let game = step(stacked(P3, [3, "fire", "A1", "fire"]));
    game = step(decide(game)); // 火焰（第一次）
    expect(game.phase).toBe("decide");
    game = step(decide(game)); // 神器
    expect(game.pathArtifacts).toEqual([1]);
    expect(game.players.every((p) => p.carried === 1)).toBe(true);
    game = step(decide(game)); // 第二张火焰
    expect(game.phase).toBe("roundEnd");
    expect(game.players.map((p) => p.carried)).toEqual([0, 0, 0]);
    expect(game.players.map((p) => p.tent)).toEqual([0, 0, 0]);
    expect(game.removed.fire).toBe(1);
    expect(game.pathArtifacts).toEqual([]);
    expect(game.artifactsLost).toEqual([1]);
    expect(game.events).toContainEqual({ type: "Collapse", hazard: "fire", caught: ["a", "b", "c"], lostGems: 1, removedNow: 1 });
    expect(game.history[0]).toMatchObject({ round: 1, reason: "collapse", hazard: "fire", caught: ["a", "b", "c"], artifactsDiscarded: [1] });
    game = step(game);
    expect(game.round).toBe(2);
    expect(game.phase).toBe("start");
    expect(hazardsInDeck(game, "fire")).toBe(2);
    expect(game.deck).toHaveLength(30);
    expect(game.deckCount).toBe(30);
    expect(game.deckArtifacts).toBe(1);
    expect(buildDeck({ ...noneRemoved(), fire: 1 }, [2])).toHaveLength(30);
  });

  it("规则书 TC8 提前离开的人安全：甲第 1 张宝物后离开落袋 2 颗；之后塌方，乙丙作废，甲仍是 2", () => {
    let game = step(stacked(P3, [4, "fire", 5, "fire"]));
    game = decide(game, { a: "leave" }); // 4 → 每人 1，余 1；甲单独走：1 + 1 = 2
    expect(player(game, "a").tent).toBe(2);
    game = step(game); // 火焰
    game = step(decide(game)); // 5 → 乙丙各 2，余 1（携带 1 + 2 = 3）
    expect(player(game, "b").carried).toBe(3);
    expect(game.pathGems).toBe(1);
    game = step(decide(game)); // 火焰 → 塌方
    expect(game.phase).toBe("roundEnd");
    expect(player(game, "a").tent).toBe(2);
    expect(player(game, "b").tent).toBe(0);
    expect(player(game, "c").tent).toBe(0);
  });

  it("规则书 TC9 神器分值：按带出顺序 5,5,5,10,10", () => {
    expect([1, 2, 3, 4, 5].map(artifactValue)).toEqual([5, 5, 5, 10, 10]);
  });

  it("规则书 TC10 结算：甲帐篷 23 + 第 2 件和第 5 件神器 = 38 分；乙 30 分；甲胜", () => {
    const game = buildScene({
      players: 3,
      phase: "gameOver",
      claimsBefore: [
        { player: "p3", artifact: 1 },
        { player: "p1", artifact: 2 },
        { player: "p3", artifact: 3 },
        { player: "p3", artifact: 4 },
        { player: "p1", artifact: 5 },
      ],
      tentsBefore: { p1: 23, p2: 30, p3: 0 },
    });
    const line = game.finalResult!.scores.find((score) => score.player === "p1")!;
    expect(line.artifacts.map((claim) => [claim.order, claim.value])).toEqual([
      [2, 5],
      [5, 10],
    ]);
    expect(line).toMatchObject({ gems: 23, artifactPoints: 15, total: 38 });
    expect(game.finalResult!.scores.find((score) => score.player === "p2")!.total).toBe(30);
    expect(game.finalResult!.winners).toEqual(["p1"]);
    expect(scoreLine(player(game, "p1")).total).toBe(38);
  });

  it("规则书 TC11 打完第 5 局的局末 → gameOver；同分比神器件数，再同分并列获胜", () => {
    // 每局翻一张宝物后所有人一起离开，5 局后结束
    let game = createGame(P3, 99);
    for (let round = 1; round <= 5; round += 1) {
      expect(game.round).toBe(round);
      expect(game.phase).toBe("start");
      game = step(game);
      while (game.phase === "skip") game = step(game);
      game = decide(game, { a: "leave", b: "leave", c: "leave" });
      game = step(game);
      expect(game.phase).toBe("roundEnd");
      expect(game.history).toHaveLength(round);
      game = step(game);
    }
    expect(game.phase).toBe("gameOver");
    expect(game.round).toBe(5);
    expect(game.finalResult).toBeDefined();
    expect(game.events[0]).toMatchObject({ type: "GameEnded" });
    expect(() => advance(game)).toThrow();

    const tieBreak = buildScene({
      players: 3,
      phase: "gameOver",
      claimsBefore: [{ player: "p1", artifact: 1 }],
      tentsBefore: { p1: 25, p2: 30, p3: 10 },
    });
    expect(tieBreak.finalResult!.scores.map((s) => s.total)).toEqual([30, 30, 10]);
    expect(tieBreak.finalResult!.winners).toEqual(["p1"]);
    expect(tieBreak.finalResult!.scores.map((s) => [s.player, s.rank])).toEqual([
      ["p1", 1],
      ["p2", 2],
      ["p3", 3],
    ]);

    const shared = buildScene({
      players: 4,
      phase: "gameOver",
      claimsBefore: [
        { player: "p1", artifact: 1 },
        { player: "p2", artifact: 2 },
      ],
      tentsBefore: { p1: 25, p2: 25, p3: 30, p4: 3 },
    });
    expect(shared.finalResult!.winners).toEqual(["p1", "p2"]);
    expect(shared.finalResult!.scores.filter((s) => s.rank === 1)).toHaveLength(2);
    expect(shared.finalResult!.scores.find((s) => s.player === "p3")!.rank).toBe(3);
  });

  it("规则书 TC12 决定校验：不在神庙里的人、已翻下一张后、值不是 stay/leave 都拒绝", () => {
    let game = step(stacked(P4, [11, 5]));
    game = decide(game, { a: "leave" });
    const oldTurn = game.turn;
    // 亮出之后、下一张翻出之前：谁都不能再决定
    expect(() => apply(game, "b", { type: "decide", choice: "leave" })).toThrow();
    game = step(game);
    expect(game.phase).toBe("decide");
    // 不在神庙里
    expect(() => apply(game, "a", { type: "decide", choice: "stay" })).toThrow(/离开/);
    // 上一张牌的决定（turn 对不上）
    expect(() => apply(game, "b", { type: "decide", choice: "leave", turn: oldTurn })).toThrow(/结束/);
    // 值不对
    expect(() => apply(game, "b", { type: "decide", choice: "run" as never })).toThrow();
    expect(() => apply(game, "b", { type: "jump" } as never)).toThrow();
    // 不在这局里
    expect(() => apply(game, "z", { type: "decide", choice: "stay" })).toThrow();
    // 正常的可以
    expect(apply(game, "b", { type: "decide", choice: "leave", turn: game.turn }).state.players[1]!.decided).toBe(true);
  });
});

describe("补充文件新增用例 S1–S9", () => {
  it("补充 S1 神器跨局保留（E1）：第 1 局没翻到神器就塌方 → 第 2 局牌堆 15+14+2=31", () => {
    let game = step(stacked(P3, [1, "snake", 2, 3, "snake"]));
    for (let flips = 1; flips < 5; flips += 1) game = step(decide(game));
    expect(game.phase).toBe("roundEnd");
    expect(game.removed.snake).toBe(1);
    expect(game.deck.some((card) => card.kind === "artifact" && card.artifact === 1)).toBe(true);
    expect(game.artifactsLost).toEqual([]);
    game = step(game);
    expect(game.round).toBe(2);
    expect(game.deck).toHaveLength(31);
    expect(game.deckArtifacts).toBe(2);
    expect(game.deck.filter((card) => card.kind === "artifact").map((card) => (card as { artifact: number }).artifact).sort()).toEqual([1, 2]);
    expect(hazardsInDeck(game, "snake")).toBe(2);
    expect(game.events[0]).toMatchObject({ type: "RoundStarted", round: 2, deckCount: 31, deckArtifacts: 2, newArtifact: 2 });
  });

  it("补充 S2 作废神器不占序号（E3）：第 1 局神器作废；第 2 局丁单独带出的算第 1 件 5 分", () => {
    let game = step(stacked(P4, [5, "A1", "fire", "fire"]));
    game = step(decide(game)); // A1
    game = decide(game, { a: "leave", b: "leave" });
    expect(game.pathArtifacts).toEqual([1]);
    game = step(game); // fire
    game = step(decide(game)); // fire → 塌方
    expect(game.phase).toBe("roundEnd");
    expect(game.artifactsLost).toEqual([1]);
    expect(game.artifactsClaimed).toBe(0);
    game = step(game); // 第 2 局
    expect(game.deckArtifacts).toBe(1);
    game = stackDeck(game, [parseCard(3), parseCard("A2")]);
    game = step(decide(step(game))); // 3，大家继续，翻 A2
    expect(game.pathArtifacts).toEqual([2]);
    game = decide(game, { d: "leave" });
    expect(player(game, "d").artifacts).toEqual([{ artifact: 2, order: 1, value: 5, round: 2 }]);
  });

  it("补充 S3 一次拿两件跨过 10 分线：已带出 2 件，乙单独离开拿第 3 件（5）和第 4 件（10），共 15", () => {
    let game = buildScene({
      players: 4,
      round: 4,
      claimsBefore: [
        { player: "p1", artifact: 1 },
        { player: "p3", artifact: 2 },
      ],
      path: [5, "A3", "A4"],
    });
    expect(game.phase).toBe("decide");
    expect(game.artifactsClaimed).toBe(2);
    expect(game.pathArtifacts).toEqual([3, 4]);
    game = decide(game, { p2: "leave" });
    const claims = player(game, "p2").artifacts;
    expect(claims).toEqual([
      { artifact: 3, order: 3, value: 5, round: 4 },
      { artifact: 4, order: 4, value: 10, round: 4 },
    ]);
    expect(claims.reduce((sum, claim) => sum + claim.value, 0)).toBe(15);
    expect(game.artifactsClaimed).toBe(4);
  });

  it("补充 S4 同种危险移除两次（E2）：火焰第 1、2 局各爆一次 → removed.fire=2，第 3 局只剩 1 张火焰，出现了也不会爆", () => {
    let game = step(stacked(P3, [2, "fire", "fire"]));
    game = step(decide(step(decide(game))));
    expect(game.phase).toBe("roundEnd");
    game = step(game);
    game = stackDeck(game, [parseCard(2), parseCard("fire"), parseCard("fire")]);
    game = step(decide(step(decide(step(game)))));
    expect(game.phase).toBe("roundEnd");
    expect(game.removed.fire).toBe(2);
    game = step(game);
    expect(game.round).toBe(3);
    expect(hazardsInDeck(game, "fire")).toBe(1);
    expect(game.deck.filter((card) => card.kind === "hazard")).toHaveLength(13);
    // 前两局的神器都没翻出来，加上第 3 件：3 件
    expect(game.deck).toHaveLength(15 + 13 + 3);
    game = stackDeck(game, [parseCard(5), parseCard("fire")]);
    game = step(decide(step(game)));
    expect(game.phase).toBe("decide");
    expect(deckInfo(game).hazards.fire).toBe(0);
    expect(bustChance(game)).toBe(0);
  });

  it("补充 S5 局末余数作废（E4）：3 人 11、13 后同时离开各存 8；p=2 时三人同走各得 0，局末 p 清零", () => {
    let game = step(stacked(P3, [11, 13]));
    expect(game.pathGems).toBe(2);
    game = step(decide(game));
    expect(game.pathGems).toBe(3);
    expect(game.players.every((p) => p.carried === 7)).toBe(true);
    game = decide(game, { a: "leave", b: "leave", c: "leave" });
    expect(game.players.map((p) => p.tent)).toEqual([8, 8, 8]);
    expect(game.pathGems).toBe(0);
    game = step(game);
    expect(game.phase).toBe("roundEnd");
    expect(game.history[0]).toMatchObject({ reason: "allLeft", pathGemsDiscarded: 0 });

    let other = step(stacked(P3, [5]));
    expect(other.pathGems).toBe(2);
    other = decide(other, { a: "leave", b: "leave", c: "leave" });
    expect(other.players.map((p) => p.tent)).toEqual([1, 1, 1]);
    expect(other.pathGems).toBe(2);
    other = step(other);
    expect(other.phase).toBe("roundEnd");
    expect(other.pathGems).toBe(0);
    expect(other.history[0]!.pathGemsDiscarded).toBe(2);
    other = step(other);
    expect(other.round).toBe(2);
    expect(other.pathGems).toBe(0);
  });

  it("补充 S6 最后一人离开拿神器：甲、乙先后单独离开（路上没神器），之后翻出神器，丙单独离开拿走", () => {
    let game = step(stacked(P3, [4, 3, "A1"]));
    game = step(decide(game, { a: "leave" }));
    expect(player(game, "a").artifacts).toEqual([]);
    game = step(decide(game, { b: "leave" }));
    expect(game.path.at(-1)).toEqual({ kind: "artifact", artifact: 1 });
    expect(game.players.filter((p) => p.inTemple).map((p) => p.id)).toEqual(["c"]);
    game = decide(game, { c: "leave" });
    expect(player(game, "c").artifacts).toEqual([{ artifact: 1, order: 1, value: 5, round: 1 }]);
    game = step(game);
    expect(game.phase).toBe("roundEnd");
    expect(game.history[0]!.artifactsDiscarded).toEqual([]);
  });

  it("补充 S7 最后两人同时离开：路上的神器谁都拿不到，局末作废", () => {
    let game = step(stacked(P3, [5, "A1"]));
    game = step(decide(game, { a: "leave" }));
    expect(game.pathArtifacts).toEqual([1]);
    game = decide(game, { b: "leave", c: "leave" });
    expect(player(game, "b").artifacts).toEqual([]);
    expect(player(game, "c").artifacts).toEqual([]);
    expect(game.pathArtifacts).toEqual([1]);
    game = step(game);
    expect(game.phase).toBe("roundEnd");
    expect(game.history[0]).toMatchObject({ reason: "allLeft", artifactsDiscarded: [1] });
    expect(game.artifactsLost).toEqual([1]);
    expect(game.artifactsClaimed).toBe(0);
    expect(game.pathArtifacts).toEqual([]);
  });

  it("补充 S8 先走的人安全（TC8 具体版）：甲存 3；乙丙携带 4 颗在火焰第二次出现时清零；removed.fire=1", () => {
    let game = step(stacked(P3, [7, "fire", 4, "fire"]));
    expect(game.players.every((p) => p.carried === 2)).toBe(true);
    expect(game.pathGems).toBe(1);
    game = decide(game, { a: "leave" });
    expect(player(game, "a").tent).toBe(3);
    expect(game.pathGems).toBe(0);
    game = step(decide(step(game))); // 火焰 → 4
    expect(player(game, "b").carried).toBe(4);
    expect(player(game, "c").carried).toBe(4);
    expect(game.pathGems).toBe(0);
    game = step(decide(game)); // 火焰
    expect(game.events).toContainEqual({ type: "Collapse", hazard: "fire", caught: ["b", "c"], lostGems: 4, removedNow: 1 });
    expect(player(game, "a").tent).toBe(3);
    expect(player(game, "b").tent).toBe(0);
    expect(game.removed.fire).toBe(1);
  });

  it("补充 S9 携带量相同（E9）：任何时刻神庙里的人携带宝石相等", () => {
    let game = step(stacked(P4, [9, 2, 15, "A1", 7]));
    game = step(decide(game, { a: "leave" }));
    game = step(decide(game, { b: "leave", c: "leave" }));
    for (const state of [game, step(decide(game))]) {
      const explorers = state.players.filter((p) => p.inTemple);
      expect(new Set(explorers.map((p) => p.carried)).size).toBe(1);
    }
  });
});

describe("勘误和其他规则", () => {
  it("勘误 E10 本局第一张就是危险：不用决定，直接翻下一张，并发提示事件", () => {
    let game = step(stacked(P3, ["spider", 9]));
    expect(game.phase).toBe("skip");
    expect(game.events).toContainEqual({ type: "FirstHazardSkipped", hazard: "spider" });
    expect(() => apply(game, "a", { type: "decide", choice: "leave" })).toThrow();
    game = step(game);
    expect(game.phase).toBe("decide");
    expect(game.path).toHaveLength(2);
    expect(game.players.every((p) => p.carried === 3)).toBe(true);
  });

  it("勘误 E10 后半：每局第一张翻牌前不用决定（start 阶段不收决定）", () => {
    const game = createGame(P3, 5);
    expect(game.phase).toBe("start");
    expect(game.path).toEqual([]);
    expect(() => apply(game, "a", { type: "decide", choice: "stay" })).toThrow();
  });

  it("第二张就是同种危险也照样塌方（第一张跳过了决定）", () => {
    let game = step(stacked(P3, ["mummy", "mummy"]));
    expect(game.phase).toBe("skip");
    game = step(game);
    expect(game.phase).toBe("roundEnd");
    expect(game.removed.mummy).toBe(1);
    expect(game.history[0]).toMatchObject({ reason: "collapse", caught: ["a", "b", "c"], lostGems: 0 });
  });

  it("勘误 E5 塌方时路上的神器作废、牌堆里的不动：第 2 局时第 1 局路上的神器不回牌堆", () => {
    let game = step(stacked(P3, [1, "A1", "rocks", "rocks"]));
    game = step(decide(step(decide(game))));
    game = step(decide(game));
    expect(game.phase).toBe("roundEnd");
    expect(game.artifactsLost).toEqual([1]);
    game = step(game);
    expect(game.deck.filter((card) => card.kind === "artifact")).toEqual([{ kind: "artifact", artifact: 2 }]);
  });

  it("勘误 E8 带出的神器公开、帐篷宝石只给本人（见 redact.test.ts）；离开记录不含宝石数", () => {
    let game = step(stacked(P3, [11, "A1"]));
    game = step(decide(game));
    game = decide(game, { b: "leave" });
    expect(game.departures).toEqual([{ round: 1, after: 2, players: ["b"], artifacts: [{ artifact: 1, order: 1, value: 5, round: 1 }] }]);
    expect(JSON.stringify(game.departures)).not.toMatch(/gems|tent/);
  });

  it("开房选项「无神器」：每局牌堆都没有神器（30 − 移出的危险）", () => {
    let game = createGame(P4, 3, { noArtifacts: true });
    expect(game.config.noArtifacts).toBe(true);
    expect(game.deck).toHaveLength(30);
    expect(game.deckArtifacts).toBe(0);
    expect(game.events[0]).toMatchObject({ type: "RoundStarted", newArtifact: null });
    for (let round = 1; round <= 5; round += 1) {
      expect(game.deck.some((card) => card.kind === "artifact")).toBe(false);
      game = step(game);
      while (game.phase === "skip") game = step(game);
      game = step(decide(game, { a: "leave", b: "leave", c: "leave", d: "leave" }));
      game = step(game);
    }
    expect(game.phase).toBe("gameOver");
  });

  it("决定可以改、可以撤回；最后一个人决定的同一步亮出，之后不能撤回", () => {
    let game = step(stacked(P3, [9]));
    game = apply(game, "a", { type: "decide", choice: "stay" }).state;
    expect(game.events).toEqual([{ type: "Decided", player: "a" }]);
    game = apply(game, "a", { type: "decide", choice: "leave" }).state;
    expect(player(game, "a").choice).toBe("leave");
    game = apply(game, "a", { type: "undecide" }).state;
    expect(game.events).toEqual([{ type: "Undecided", player: "a" }]);
    expect(player(game, "a").decided).toBe(false);
    expect(() => apply(game, "a", { type: "undecide" })).toThrow();
    game = apply(game, "a", { type: "decide", choice: "stay" }).state;
    game = apply(game, "b", { type: "decide", choice: "stay" }).state;
    expect(game.phase).toBe("decide");
    game = apply(game, "c", { type: "decide", choice: "leave" }).state;
    expect(game.phase).toBe("reveal");
    expect(game.events.map((event) => event.type)).toEqual(["Decided", "ChoicesRevealed", "PlayersLeft"]);
    expect(game.events[1]).toEqual({ type: "ChoicesRevealed", stay: ["a", "b"], leave: ["c"] });
    expect(() => apply(game, "a", { type: "undecide" })).toThrow();
  });

  it("离开的人这一局不能再回来；神庙里没人后 advance 结束本局", () => {
    let game = step(stacked(P3, [9, 7]));
    game = step(decide(game, { a: "leave" }));
    expect(player(game, "a").inTemple).toBe(false);
    expect(player(game, "a").leftAfter).toBe(1);
    game = decide(game, { b: "leave", c: "leave" });
    expect(game.players.every((p) => !p.inTemple)).toBe(true);
    game = step(game);
    expect(game.phase).toBe("roundEnd");
    expect(game.events).toEqual([expect.objectContaining({ type: "RoundEnded" })]);
    game = step(game);
    expect(game.players.every((p) => p.inTemple && p.leftAfter === null && p.carried === 0)).toBe(true);
  });

  it("超时：没决定的人按离开处理（TimedOut），已决定的人照自己的选", async () => {
    const { timeoutTurn } = await import("../src/index.js");
    let game = step(stacked(P4, [11]));
    game = apply(game, "a", { type: "decide", choice: "stay" }).state;
    game = apply(game, "c", { type: "decide", choice: "leave" }).state;
    const after = timeoutTurn(game);
    expect(after.phase).toBe("reveal");
    expect(after.events[0]).toEqual({ type: "TimedOut", players: ["b", "d"] });
    expect(after.events[1]).toEqual({ type: "ChoicesRevealed", stay: ["a"], leave: ["b", "c", "d"] });
    expect(after.log!.at(-1)).toEqual({ player: "", command: { type: "TIMEOUT", players: ["b", "d"] } });
    // 自动阶段的「超时」就是 advance
    expect(timeoutTurn(after).version).toBe(after.version + 1);
  });

  it("终局总分 = 帐篷宝石 + 神器分，结果按名次排", () => {
    const game = buildScene({ players: 3, phase: "gameOver", tentsBefore: { p1: 5, p2: 40, p3: 12 } });
    expect(computeFinalResult(game).scores.map((s) => [s.player, s.total, s.rank])).toEqual([
      ["p2", 40, 1],
      ["p3", 12, 2],
      ["p1", 5, 3],
    ]);
  });

  it("人数：3–8 人可以开，2 人、9 人不行", () => {
    const people = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `p${index}`, name: `玩家${index}` }));
    for (let n = 3; n <= 8; n += 1) expect(createGame(people(n), 1).players).toHaveLength(n);
    expect(() => createGame(people(2), 1)).toThrow();
    expect(() => createGame(people(9), 1)).toThrow();
  });
});
