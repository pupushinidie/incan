import { describe, expect, it } from "vitest";
import {
  advance,
  advanceGame,
  apply,
  applyCommand,
  buildScene,
  checkConservation,
  createGame,
  createRng,
  decideAll,
  deckInfo,
  legalActions,
  pendingDeciders,
  previewScene,
  redactGameForViewer,
  SCENE_LIST,
  SCENES,
  stackDeck,
  timeoutTurn,
  timerKey,
  timerMs,
  type GameState,
} from "../src/index.js";
import { parseCard } from "../src/cards.js";
import { decide, deepFreeze, P3, P4, player, stacked, step } from "./helpers.js";

describe("引擎接口", () => {
  it("apply / advance / timeoutTurn 不修改输入（深冻结的状态也能用）", () => {
    let game = deepFreeze(createGame(P4, 11));
    game = deepFreeze(advance(game).state);
    while (game.phase === "skip") game = deepFreeze(advance(game).state);
    const decided = deepFreeze(apply(game, "a", { type: "decide", choice: "leave" }).state);
    deepFreeze(apply(decided, "a", { type: "undecide" }).state);
    deepFreeze(timeoutTurn(decided));
    deepFreeze(stackDeck(game, []));
    deepFreeze(decideAll(game));
  });

  it("每一步 version +1；createGame 时为 0", () => {
    let game = createGame(P3, 2);
    expect(game.version).toBe(0);
    game = step(game);
    expect(game.version).toBe(1);
    const next = apply(game.phase === "skip" ? step(game) : game, "a", { type: "decide", choice: "stay" }).state;
    expect(next.version).toBeGreaterThan(game.version);
  });

  it("同一种子 + 同一串动作 → 完全相同的对局（服务器日志可复盘）", () => {
    const play = () => {
      let game = createGame(P4, 12345);
      let guard = 0;
      while (game.phase !== "gameOver" && guard++ < 500) {
        if (game.phase === "decide") {
          const first = pendingDeciders(game)[0]!;
          game = applyCommand(game, first, { type: "decide", choice: game.path.length % 3 === 0 ? "leave" : "stay", turn: game.turn });
        } else game = advanceGame(game);
      }
      return game;
    };
    const a = play();
    const b = play();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // 换种子就不一样
    expect(createGame(P4, 1).deck).not.toEqual(createGame(P4, 2).deck);
  });

  it("洗牌用传进 advance 的 rng（教程可以按剧本出牌）；不传就接着状态里的随机数", () => {
    let game = step(stacked(P3, [5]));
    game = step(decide(game, { a: "leave", b: "leave", c: "leave" }));
    expect(game.phase).toBe("roundEnd");
    const scripted = { ...createRng(1), shuffle: <T,>(items: readonly T[]) => [...items] };
    const fixed = advance(game, scripted).state;
    expect(fixed.deck[0]).toEqual({ kind: "treasure", gems: 1 });
    expect(advance(game).state.deck).toEqual(advance(game).state.deck);
  });

  it("计时 key：别人的 decide / undecide 不改；翻出下一张、进自动阶段才变", () => {
    let game = step(stacked(P4, [11, 3]));
    const key = timerKey(game);
    game = apply(game, "a", { type: "decide", choice: "stay" }).state;
    expect(timerKey(game)).toBe(key);
    game = apply(game, "a", { type: "undecide" }).state;
    game = apply(game, "b", { type: "decide", choice: "leave" }).state;
    expect(timerKey(game)).toBe(key);
    game = decide(game);
    expect(game.phase).toBe("reveal");
    expect(timerKey(game)).not.toBe(key);
    const revealKey = timerKey(game);
    game = step(game);
    expect(timerKey(game)).not.toBe(revealKey);
    expect(timerKey(game)).not.toBe(key);
  });

  it("时限：决定 30 秒；开局、跳过、亮出（有人走时更久）、局末 5 秒", () => {
    const opening = createGame(P3, 1);
    expect(timerMs(opening)).toBe(opening.config.pauseMs.start);
    const deciding = step(stacked(P3, [9]));
    expect(timerMs(deciding)).toBe(30_000);
    expect(timerMs(decide(deciding))).toBe(deciding.config.pauseMs.reveal);
    expect(timerMs(decide(deciding, { a: "leave" }))).toBe(deciding.config.pauseMs.revealLeave);
    expect(timerMs(previewScene("firstHazard"))).toBe(deciding.config.pauseMs.skip);
    expect(timerMs(previewScene("collapse"))).toBe(5000);
    expect(timerMs(previewScene("gameOver"))).toBe(0);
  });

  it("legalActions / pendingDeciders：没决定 [继续, 离开]；决定了 [撤回, 改选]；离开的人和自动阶段没有", () => {
    let game = step(stacked(P3, [9]));
    expect(pendingDeciders(game)).toEqual(["a", "b", "c"]);
    expect(legalActions(game, "a")).toEqual([
      { type: "decide", choice: "stay", turn: game.turn },
      { type: "decide", choice: "leave", turn: game.turn },
    ]);
    game = apply(game, "a", { type: "decide", choice: "stay" }).state;
    expect(pendingDeciders(game)).toEqual(["b", "c"]);
    expect(legalActions(game, "a")).toEqual([
      { type: "undecide", turn: game.turn },
      { type: "decide", choice: "leave", turn: game.turn },
    ]);
    game = decide(game, { b: "leave" });
    expect(legalActions(game, "a")).toEqual([]);
    expect(pendingDeciders(game)).toEqual([]);
    game = step(game);
    expect(legalActions(game, "b")).toEqual([]);
    expect(legalActions(game, "zz")).toEqual([]);
  });

  it("advance 在决定中、对局结束时拒绝", () => {
    expect(() => advance(step(stacked(P3, [9])))).toThrow(/决定/);
    expect(() => advance(previewScene("gameOver"))).toThrow();
  });

  it("deckInfo 只用公开信息就能算出牌堆张数和组成（脱敏后也一样）", () => {
    let game = step(stacked(P4, [11, "snake", "A1", 4, "snake"]));
    for (let guard = 0; guard < 6 && game.phase !== "roundEnd"; guard += 1) {
      const info = deckInfo(redactGameForViewer(game, "a"));
      expect(info.total).toBe(game.deck.length);
      expect(info.artifacts).toBe(game.deck.filter((card) => card.kind === "artifact").length);
      expect(info.treasureGems).toBe(game.deck.reduce((sum, card) => sum + (card.kind === "treasure" ? card.gems : 0), 0));
      game = step(decide(game));
    }
    expect(game.phase).toBe("roundEnd");
    expect(deckInfo(game).total).toBe(game.deck.length);
  });

  it("stackDeck：挪到牌堆顶；牌堆里没有的牌报错", () => {
    const game = createGame(P3, 9);
    const top = stackDeck(game, [parseCard(17), parseCard("A1"), parseCard("spider")]);
    expect(top.deck.slice(0, 3)).toEqual([{ kind: "treasure", gems: 17 }, { kind: "artifact", artifact: 1 }, { kind: "hazard", hazard: "spider" }]);
    expect(top.deck).toHaveLength(31);
    expect(() => stackDeck(game, [parseCard("A2")])).toThrow();
    expect(() => stackDeck(game, [parseCard(17), parseCard(17)])).toThrow();
  });
});

describe("预览局面工厂", () => {
  it("每个有名字的局面都能造出来，配件守恒，阶段对", () => {
    const expected: Record<string, string> = {
      opening: "start",
      treasure: "decide",
      hazard: "decide",
      artifact: "decide",
      deciding: "decide",
      firstHazard: "skip",
      reveal: "reveal",
      twoLeaveArtifact: "reveal",
      soloArtifact: "reveal",
      multiArtifact: "decide",
      collapse: "roundEnd",
      allLeft: "roundEnd",
      lastRound: "decide",
      gameOver: "gameOver",
      gameOverTieBreak: "gameOver",
      gameOverShared: "gameOver",
      noArtifacts: "decide",
      eightPlayers: "decide",
      timeout: "reveal",
    };
    expect(SCENE_LIST.sort()).toEqual(Object.keys(expected).sort());
    for (const name of SCENE_LIST) {
      const game = previewScene(name);
      expect(game.phase, name).toBe(expected[name]);
      expect(checkConservation(game), name).toEqual([]);
      expect(SCENES[name].title.length).toBeGreaterThan(0);
    }
  });

  it("局面能接着打下去（和真打出来的状态一样能用）", () => {
    for (const name of SCENE_LIST) {
      let game = previewScene(name);
      for (let guard = 0; guard < 400 && game.phase !== "gameOver"; guard += 1) {
        game = game.phase === "decide" ? decide(game, Object.fromEntries(pendingDeciders(game).map((id, index) => [id, index === 0 ? "leave" : "stay"]))) : step(game);
        expect(checkConservation(game), `${name} @${game.round}/${game.phase}`).toEqual([]);
      }
      expect(game.phase, name).toBe("gameOver");
    }
  });

  it("模拟出来的数字和规则一致：treasure（TC3）、reveal（TC4）、soloArtifact（S3）、collapse、allLeft（E3/E4）", () => {
    const treasure = previewScene("treasure");
    expect(treasure.players.map((p) => p.carried)).toEqual([2, 2, 2, 2]);
    expect(treasure.pathGems).toBe(3);
    const reveal = previewScene("reveal");
    expect(reveal.pathGems).toBe(1);
    expect(player(reveal, "p2").tent).toBe(3);
    expect(reveal.events.map((event) => event.type)).toEqual(["ChoicesRevealed", "PlayersLeft"]);
    expect(reveal.events[1]).toMatchObject({ players: ["p2", "p4"], carried: 2, share: 1, pathGemsBefore: 3, pathGemsAfter: 1 });
    const solo = previewScene("soloArtifact");
    expect(player(solo, "p3").artifacts.map((claim) => [claim.artifact, claim.order, claim.value])).toEqual([
      [3, 3, 5],
      [4, 4, 10],
    ]);
    expect(solo.deck[0]).toEqual({ kind: "hazard", hazard: "rocks" });
    const collapse = previewScene("collapse");
    expect(collapse.history.at(-1)).toMatchObject({ reason: "collapse", hazard: "fire", caught: ["p3", "p4"], lostGems: 5 });
    expect(collapse.removed.fire).toBe(1);
    expect(player(collapse, "p1").tent).toBe(12);
    const allLeft = previewScene("allLeft");
    expect(allLeft.history.at(-1)).toMatchObject({ reason: "allLeft", artifactsDiscarded: [1], pathGemsDiscarded: 1 });
    expect(allLeft.artifactsLost).toEqual([1]);
  });

  it("buildScene 拒绝不可能的局面", () => {
    expect(() => buildScene({ players: 2 })).toThrow();
    expect(() => buildScene({ path: ["fire", "fire", 3] })).toThrow(/塌方/);
    expect(() => buildScene({ path: ["fire", 3], leftAfter: { p1: 1 } })).toThrow(/第一张/);
    expect(() => buildScene({ path: [17, 17] })).toThrow();
    expect(() => buildScene({ path: ["A2"] })).toThrow();
    expect(() => buildScene({ round: 2, removed: { fire: 2 } })).toThrow();
    expect(() => buildScene({ path: [3], choices: { p1: "stay", p2: "stay", p3: "stay", p4: "stay" } })).toThrow(/亮出/);
    expect(() => buildScene({ path: [3], leftAfter: { p1: 1 }, phase: "decide" })).toThrow();
    expect(() => buildScene({ options: { noArtifacts: true }, path: ["artifact"] })).toThrow();
    expect(() => buildScene({ round: 2, claimsBefore: [{ player: "p9", artifact: 1 }] })).toThrow();
  });

  it("buildScene 造出的局面：前几局的东西照给的数，这一局按规则模拟", () => {
    const game: GameState = buildScene({
      players: ["甲", "乙", "丙"],
      round: 3,
      removed: { snake: 1, rocks: 1 },
      claimsBefore: [{ player: "p2", artifact: 1, round: 2 }],
      lostBefore: [2],
      tentsBefore: { p1: 10, p2: 4 },
      path: [9, "A3", "snake", 2],
      leftAfter: { p1: 2 },
      choices: { p2: "leave" },
      deckTop: [17],
    });
    expect(game.round).toBe(3);
    expect(game.phase).toBe("decide");
    expect(game.players.map((p) => p.name)).toEqual(["甲", "乙", "丙"]);
    expect(player(game, "p1")).toMatchObject({ inTemple: false, leftAfter: 2, tent: 10 + 3 + 0, carried: 0 });
    expect(player(game, "p1").artifacts).toEqual([{ artifact: 3, order: 2, value: 5, round: 3 }]);
    expect(player(game, "p2")).toMatchObject({ inTemple: true, carried: 3 + 1, tent: 4, decided: true, choice: "leave" });
    expect(game.pathGems).toBe(0);
    expect(game.deck[0]).toEqual({ kind: "treasure", gems: 17 });
    expect(game.deckCount).toBe(15 + 13 + 0 - 3); // 宝物 15、危险 13、神器 0（1 被拿走、2 作废、3 在路上）减去路上 3 张非神器
    expect(game.deckArtifacts).toBe(0);
    expect(checkConservation(game)).toEqual([]);
  });
});
