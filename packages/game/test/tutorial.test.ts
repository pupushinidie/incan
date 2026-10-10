import { describe, expect, it } from "vitest";
import {
  AUTO_ACTOR,
  anchorVisible,
  applyTutorialMove,
  botCommand,
  bustPercent,
  createPracticeGame,
  createTutorialGame,
  legalActions,
  redactGameForViewer,
  sameMove,
  selfCanAct,
  TUTORIAL_BOTS,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type GameState,
  type TutorialMove,
} from "../src/index.js";

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length, seed = 7): GameState {
  let game = createTutorialGame("小明", seed);
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = applyTutorialMove(game, step.expect);
    if (step.kind === "watch") for (const move of step.moves) game = applyTutorialMove(game, move);
  }
  return game;
}

const stepIndex = (id: string) => {
  const at = TUTORIAL_STEPS.findIndex((step) => step.id === id);
  if (at < 0) throw new Error(`没有这一步：${id}`);
  return at;
};
const after = (id: string) => playScript(stepIndex(id) + 1);
const before = (id: string) => playScript(stepIndex(id));
const player = (game: GameState, id: string) => game.players.find((one) => one.id === id)!;
const [ONE, TWO] = TUTORIAL_BOTS.map((bot) => bot.id) as [string, string];

/** 这一步在这个局面下合不合法（命令看 legalActions，自动推进看是不是自动阶段）。 */
function legal(game: GameState, move: TutorialMove): boolean {
  if (move.command.type === "advance") return tutorialActor(game) === AUTO_ACTOR;
  return legalActions(game, move.player).some((command) => sameMove({ player: move.player, command }, move));
}

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要你做的都合法，咕噜和翻牌按剧本走得通，高亮的东西在界面上看得见", () => {
    for (const seed of [1, 7, 20261010, 99999]) {
      let game = createTutorialGame("小明", seed);
      for (const step of TUTORIAL_STEPS) {
        if (step.kind === "do") {
          if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
          expect(step.expect.player).toBe(TUTORIAL_SELF);
          expect(legal(game, step.expect), `「${step.id}」这一步不合法`).toBe(true);
          game = applyTutorialMove(game, step.expect);
        } else if (step.kind === "watch") {
          for (const move of step.moves) {
            expect(move.player === "" || move.player !== TUTORIAL_SELF, `「${step.id}」不能替你走`).toBe(true);
            expect(legal(game, move), `「${step.id}」里的 ${JSON.stringify(move)} 不合法`).toBe(true);
            game = applyTutorialMove(game, move);
          }
          if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」走完后高亮的 ${step.anchor} 看不见`).toBe(true);
        } else if (step.anchor) {
          expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
        }
      }
      // 剧本停在第 3 局开头，等练习局接着翻
      expect(game.round).toBe(3);
      expect(game.phase).toBe("start");
    }
  });

  it("关键的几幕一定发生", () => {
    // 宝物 11：3 人每人 3 颗，余 2 留在路上
    const split = before("split");
    expect(split.path).toEqual([{ kind: "treasure", gems: 11 }]);
    expect(split.players.map((one) => one.carried)).toEqual([3, 3, 3]);
    expect(split.pathGems).toBe(2);

    // 火焰第一次出现没事；剧本说的塌方机会 7% 和局面对得上
    const hazard = before("hazard");
    expect(hazard.path.at(-1)).toEqual({ kind: "hazard", hazard: "fire" });
    expect(hazard.phase).toBe("decide");
    expect(bustPercent(hazard)).toBe(7);

    // 两个咕噜一起回营地：余数每人 1 颗，神器留在路上
    const two = before("two-leave");
    expect(player(two, ONE).tent).toBe(4);
    expect(player(two, TWO).tent).toBe(4);
    expect(two.pathGems).toBe(0);
    expect(two.pathArtifacts).toEqual([1]);
    expect(player(two, TUTORIAL_SELF).inTemple).toBe(true);

    // 只剩你：宝物 5 全拿，手上 8 颗
    expect(player(before("solo-gems"), TUTORIAL_SELF).carried).toBe(8);

    // 单独回营地：8 颗进帐篷，带走第 1 件神器 5 分
    const solo = before("stored");
    const me = player(solo, TUTORIAL_SELF);
    expect(me.tent).toBe(8);
    expect(me.artifacts).toEqual([{ artifact: 1, order: 1, value: 5, round: 1 }]);

    // 第 2 局第一张是火焰：直接跳过
    const skip = before("first-hazard");
    expect(skip.round).toBe(2);
    expect(skip.phase).toBe("skip");
    expect(skip.events.some((event) => event.type === "FirstHazardSkipped")).toBe(true);

    // 第 2 局继续前，塌方机会也是 7%
    expect(bustPercent(before("stay-4"))).toBe(7);

    // 火焰第二次出现：你和咕噜二号被困，咕噜一号带回 2 + 1 颗；火焰永久少一张
    const collapse = before("collapse");
    expect(collapse.phase).toBe("roundEnd");
    const result = collapse.history.at(-1)!;
    expect(result).toMatchObject({ round: 2, reason: "collapse", hazard: "fire", lostGems: 2 });
    expect([...result.caught].sort()).toEqual([TUTORIAL_SELF, TWO].sort());
    expect(player(collapse, ONE).tent).toBe(4 + 3);
    expect(player(collapse, TUTORIAL_SELF).tent).toBe(8);
    expect(collapse.removed.fire).toBe(1);

    // 第 3 局：第 2 局的神器留在牌堆，再加一件新的
    const third = before("deck-artifacts");
    expect(third.round).toBe(3);
    expect(third.deckArtifacts).toBe(2);
  });

  it("剧本本身：id 不重复，结尾唯一且在最后，每句话都有内容、不超过两句", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.trim().length, step.id).toBeGreaterThan(0);
      expect(step.say.length, `${step.id} 主句太长`).toBeLessThanOrEqual(26);
      for (const text of [step.note, step.noteTouch]) {
        if (!text) continue;
        const sentences = text.split(/[。！？]/).filter((part) => part.trim().length > 0);
        expect(sentences.length, `${step.id} 补充超过两句`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("剧本摆的牌序生效（不受种子影响），剧本以外的牌照常随机", () => {
    const first = after("round-2-flip");
    const second = playScript(stepIndex("round-2-flip") + 1, 12345);
    expect(first.path).toEqual(second.path);
    expect(first.path).toEqual([{ kind: "hazard", hazard: "fire" }, { kind: "treasure", gems: 7 }]);
    const a = playScript(TUTORIAL_STEPS.length, 1);
    const b = playScript(TUTORIAL_STEPS.length, 2);
    expect(applyTutorialMove(a, { player: "", command: { type: "advance" } }).path).not.toEqual(
      applyTutorialMove(b, { player: "", command: { type: "advance" } }).path,
    );
  });

  it("剧本走完接练习局：咕噜交给人机（只看脱敏局面），你也交给人机代打，150 局都能打完", () => {
    const stuck: number[] = [];
    for (let seed = 1; seed <= 150; seed += 1) {
      let game = seed % 2 ? playScript(TUTORIAL_STEPS.length, seed) : createPracticeGame("小明", seed);
      let steps = 0;
      while (game.phase !== "gameOver" && steps < 2000) {
        const actor = tutorialActor(game);
        if (actor === null) break;
        if (actor === AUTO_ACTOR) {
          game = applyTutorialMove(game, { player: "", command: { type: "advance" } });
        } else {
          if (actor === TUTORIAL_SELF) expect(selfCanAct(game)).toBe(true);
          const command = botCommand(redactGameForViewer(game, actor), actor);
          if (!command) break;
          game = applyTutorialMove(game, { player: actor, command });
        }
        steps += 1;
      }
      if (game.phase !== "gameOver") stuck.push(seed);
    }
    expect(stuck).toEqual([]);
  });
});
