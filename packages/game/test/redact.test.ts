import { describe, expect, it } from "vitest";
import {
  apply,
  botCommand,
  buildScene,
  previewRoom,
  previewScene,
  previewSocketId,
  redactGameForViewer,
  SCENE_LIST,
  type GameState,
} from "../src/index.js";
import { decide, P4, stacked, step } from "./helpers.js";

const SERVER_ONLY = ["seed", "rngState", "log"] as const;

function serverFieldsGone(view: GameState): void {
  expect(view.deck).toEqual([]);
  for (const key of SERVER_ONLY) expect((view as unknown as Record<string, unknown>)[key]).toBeUndefined();
}

describe("隐藏信息（redactGameForViewer）", () => {
  // 打到第 2 局决定中：有人帐篷里有宝石、有人带出了神器、有人已经决定
  function midGame(): GameState {
    let game = step(stacked(P4, [11, "A1", 9, "fire", "fire"]));
    game = decide(game, { a: "leave" }); // 甲单独走：2 + 3 = 5
    game = step(game); // A1
    game = decide(game, { b: "leave" }); // 乙单独走：拿神器
    game = step(game); // 9：丙丁各 4，余 1
    game = apply(game, "c", { type: "decide", choice: "leave" }).state;
    return game;
  }

  it("每个玩家视角：牌堆顺序、种子、动作序列拿不到；别人的帐篷是 null，自己的看得到", () => {
    const game = midGame();
    expect(game.players.map((p) => p.tent)).toEqual([5, 2, 0, 0]);
    for (const viewer of game.players) {
      const view = redactGameForViewer(game, viewer.id);
      serverFieldsGone(view);
      expect(view.deckCount).toBe(game.deck.length);
      for (const other of view.players) {
        if (other.id === viewer.id) expect(other.tent).toBe(viewer.tent);
        else expect(other.tent).toBeNull();
      }
      // 带出的神器、携带宝石、谁在神庙、路径都是公开的
      expect(view.players.map((p) => p.artifacts)).toEqual(game.players.map((p) => p.artifacts));
      expect(view.players.map((p) => p.carried)).toEqual(game.players.map((p) => p.carried));
      expect(view.players.map((p) => p.inTemple)).toEqual(game.players.map((p) => p.inTemple));
      expect(view.path).toEqual(game.path);
      expect(view.pathGems).toBe(game.pathGems);
      // 序列化后也找不到别人的帐篷数（5 和 2 在别的地方也可能出现，所以查字段）
      expect(JSON.stringify(view.players.filter((p) => p.id !== viewer.id).map((p) => p.tent))).not.toMatch(/\d/);
    }
  });

  it("决定中只公开「已决定 / 未决定」：别人的选择是 null，自己的看得到；事件里也没有选择", () => {
    const game = midGame();
    expect(game.phase).toBe("decide");
    const view = redactGameForViewer(game, "d");
    const c = view.players.find((p) => p.id === "c")!;
    expect(c.decided).toBe(true);
    expect(c.choice).toBeNull();
    expect(JSON.stringify(view.events)).not.toContain("leave");
    expect(JSON.stringify(view)).not.toContain('"leave"');
    expect(redactGameForViewer(game, "c").players.find((p) => p.id === "c")!.choice).toBe("leave");
  });

  it("亮出（reveal）后所有人的选择公开", () => {
    const game = decide(midGame(), { d: "stay" });
    expect(game.phase).toBe("reveal");
    const view = redactGameForViewer(game, "a");
    expect(view.players.find((p) => p.id === "c")!.choice).toBe("leave");
    expect(view.players.find((p) => p.id === "d")!.choice).toBe("stay");
  });

  it("观战（viewerId 空）：默认谁的帐篷都看不到；seeAll（观战看帐篷）看得到帐篷但看不到决定中的选择；牌堆和种子永远拿不到", () => {
    const game = midGame();
    const blind = redactGameForViewer(game, "");
    serverFieldsGone(blind);
    expect(blind.players.every((p) => p.tent === null)).toBe(true);
    expect(blind.players.every((p) => p.choice === null)).toBe(true);
    const god = redactGameForViewer(game, "", { seeAll: true });
    serverFieldsGone(god);
    expect(god.players.map((p) => p.tent)).toEqual([5, 2, 0, 0]);
    expect(god.players.find((p) => p.id === "c")!.choice).toBeNull();
  });

  it("对局结束后所有人的帐篷公开", () => {
    const game = previewScene("gameOver");
    const view = redactGameForViewer(game, "p1");
    expect(view.players.every((p) => typeof p.tent === "number")).toBe(true);
    serverFieldsGone(view);
  });

  it("脱敏不改原状态，结果和原状态不共用对象", () => {
    const game = midGame();
    const before = JSON.stringify(game);
    const view = redactGameForViewer(game, "a");
    view.players[0]!.carried = 999;
    view.path.push({ kind: "treasure", gems: 1 });
    expect(JSON.stringify(game)).toBe(before);
  });

  it("所有预览局面 × 所有视角：都拿不到牌堆、种子、别人的帐篷", () => {
    for (const name of SCENE_LIST) {
      const game = previewScene(name);
      for (const viewer of ["", ...game.players.map((p) => p.id)]) {
        const view = redactGameForViewer(game, viewer);
        serverFieldsGone(view);
        if (game.phase !== "gameOver") {
          expect(view.players.filter((p) => p.id !== viewer).every((p) => p.tent === null)).toBe(true);
        }
        if (game.phase === "decide") {
          expect(view.players.filter((p) => p.id !== viewer).every((p) => p.choice === null)).toBe(true);
        }
      }
    }
  });

  it("previewRoom：快照里的对局已经按视角脱敏，冒充的连接 id 对得上", () => {
    const room = previewRoom(previewScene("deciding"), { viewer: "p2", offline: ["p4"], bots: ["p3"] });
    const game = room.game!;
    serverFieldsGone(game);
    expect(game.players.find((p) => p.id === "p1")!.choice).toBeNull();
    expect(room.members.find((m) => m.id === previewSocketId("p2"))!.playerId).toBe("p2");
    expect(room.members.find((m) => m.playerId === "p4")!.connected).toBe(false);
    expect(room.members.find((m) => m.playerId === "p3")!.bot).toBe(true);
    expect(room.turnRemainingMs).toBe(30_000);
    const watcher = previewRoom(previewScene("deciding"), { viewer: "" });
    expect(watcher.spectators.some((s) => s.id === previewSocketId(""))).toBe(true);
    expect(watcher.game!.players.every((p) => p.tent === null)).toBe(true);
  });

  it("人机占位只吃脱敏后的状态，也能给出合法决定", () => {
    const game = buildScene({ players: 4, path: [9, "fire"] });
    for (const player of game.players) {
      const command = botCommand(redactGameForViewer(game, player.id), player.id);
      expect(command?.type).toBe("decide");
      expect(() => apply(game, player.id, command!)).not.toThrow();
    }
    expect(botCommand(redactGameForViewer(previewScene("reveal"), "p1"), "p1")).toBeNull();
  });
});
