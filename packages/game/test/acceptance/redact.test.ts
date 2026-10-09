/**
 * 规则核对（背靠背）：隐藏信息。拍板：帐篷宝石对别人隐藏；神器件数和本局携带量公开（E8、E9）；
 * 决定中的选择亮出前隐藏（§8.3）；牌堆顺序、种子谁都拿不到。
 */
import { describe, expect, it } from "vitest";
import { advance, apply, buildScene, redactGameForViewer, type Choice, type GameState } from "../../src/index.js";
import { decide, deepFreeze, newGame, player, reveal, step } from "./helpers.js";

/** 第 3 局决定中：前两局有帐篷和神器，p1、p2 已经决定。 */
function midGame(): GameState {
	return buildScene({
		players: 4,
		round: 3,
		removed: { fire: 1 },
		claimsBefore: [
			{ player: "p2", artifact: 1, round: 1 },
			{ player: "p3", artifact: 2, round: 2 },
		],
		tentsBefore: { p1: 17, p2: 9, p3: 23, p4: 4 },
		path: [11, "snake", 7],
		choices: { p1: "leave", p2: "stay" },
	});
}

function noSecrets(r: GameState) {
	expect(r.deck).toEqual([]);
	expect(r.seed).toBeUndefined();
	expect(r.rngState).toBeUndefined();
	expect(r.log).toBeUndefined();
	const json = JSON.stringify(r);
	expect(json).not.toMatch(/"seed"|"rngState"|"log"/);
}

describe("规则核对 · 隐藏信息（redactGameForViewer）", () => {
	it("自己的帐篷看得到；别人的帐篷宝石看不到，神器件数和携带量看得到", () => {
		const g = midGame();
		expect(g.phase).toBe("decide");
		const r = redactGameForViewer(g, "p1");
		noSecrets(r);
		expect(player(r, "p1").tent).toBe(17);
		for (const id of ["p2", "p3", "p4"]) {
			expect(player(r, id).tent).toBeNull();
			expect(player(r, id).artifacts).toEqual(player(g, id).artifacts);
			expect(player(r, id).carried).toBe(player(g, id).carried);
		}
		expect(player(r, "p2").artifacts.length).toBe(1);
		// 公开的东西照常给
		expect(r.deckCount).toBe(g.deckCount);
		expect(r.deckArtifacts).toBe(g.deckArtifacts);
		expect(r.path).toEqual(g.path);
		expect(r.pathGems).toBe(g.pathGems);
		expect(r.removed).toEqual(g.removed);
		expect(r.artifactsClaimed).toBe(2);
	});

	it("决定中：别人的选择看不到（只知道已决定），自己的看得到；事件里也没有选择", () => {
		const g = midGame();
		const r1 = redactGameForViewer(g, "p1");
		expect(player(r1, "p1").choice).toBe("leave");
		expect(player(r1, "p2").decided).toBe(true);
		expect(player(r1, "p2").choice).toBeNull();
		const r3 = redactGameForViewer(g, "p3");
		expect(player(r3, "p1").decided).toBe(true);
		expect(player(r3, "p1").choice).toBeNull();
		expect(player(r3, "p2").choice).toBeNull();
		// 「有人决定了」那一步的事件和状态里也不能带出他的选择
		const u = decidePartial(reveal(newGame(3), 5), "p1", "leave");
		expect(u.phase).toBe("decide");
		const r = redactGameForViewer(u, "p2");
		expect(JSON.stringify(r.events)).not.toMatch(/leave|stay/);
		expect(player(r, "p1").decided).toBe(true);
		expect(player(r, "p1").choice).toBeNull();
	});

	it("亮出后：所有人的选择公开", () => {
		let g = reveal(newGame(4), 9);
		g = decide(g, { p1: "leave", p3: "leave" });
		expect(g.phase).toBe("reveal");
		const r = redactGameForViewer(g, "p2");
		expect(player(r, "p1").choice).toBe("leave");
		expect(player(r, "p3").choice).toBe("leave");
		expect(player(r, "p4").choice).toBe("stay");
	});

	it("观战：帐篷都看不到；房主开「观战看帐篷」时看得到，但决定中的选择照样看不到", () => {
		const g = midGame();
		const spec = redactGameForViewer(g, "");
		noSecrets(spec);
		for (const p of spec.players) {
			expect(p.tent).toBeNull();
			expect(p.choice).toBeNull();
		}
		const god = redactGameForViewer(g, "", { seeAll: true });
		noSecrets(god);
		expect(god.players.map((p) => p.tent)).toEqual([17, 9, 23, 4]);
		expect(god.players.every((p) => p.choice === null)).toBe(true);
	});

	it("终局：所有人的帐篷公开；牌堆和种子仍然不给", () => {
		const g = buildScene({ players: 3, phase: "gameOver", tentsBefore: { p1: 10, p2: 20, p3: 30 } });
		const r = redactGameForViewer(g, "p1");
		noSecrets(r);
		expect(r.players.map((p) => p.tent)).toEqual([10, 20, 30]);
		expect(r.finalResult!.winners).toEqual(["p3"]);
	});

	it("局末（还没终局）：别人的帐篷仍然隐藏", () => {
		let g = step(newGame(3), 7, { p1: "leave" });
		g = step(g, "fire");
		g = reveal(g, "fire");
		expect(g.phase).toBe("roundEnd");
		const r = redactGameForViewer(g, "p2");
		expect(player(r, "p1").tent).toBeNull();
		expect(player(r, "p2").tent).toBe(0);
		noSecrets(r);
		const next = redactGameForViewer(advance(g).state, "p3");
		noSecrets(next);
		expect(player(next, "p1").tent).toBeNull();
	});

	it("脱敏不改服务端状态", () => {
		const g = deepFreeze(midGame());
		const r = redactGameForViewer(g, "p2");
		expect(r).not.toBe(g);
		expect(g.deck.length).toBe(g.deckCount);
		expect(player(g, "p1").tent).toBe(17);
	});
});

function decidePartial(g: GameState, id: string, choice: Choice): GameState {
	return apply(g, id, { type: "decide", choice, turn: g.turn }).state;
}
