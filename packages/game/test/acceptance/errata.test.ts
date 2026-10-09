/**
 * 规则核对（背靠背）：补充文件的勘误 E1–E10 和建议用例 S1–S9，加开工拍板（神器跨局保留、首张危险跳过、无神器选项）。
 */
import { describe, expect, it } from "vitest";
import {
	advance,
	apply,
	bustChance,
	buildScene,
	deckInfo,
	legalActions,
	scoreLine,
	type GameState,
} from "../../src/index.js";
import {
	advanceUntil,
	carried,
	decide,
	eventsOf,
	newGame,
	player,
	reveal,
	step,
	tent,
} from "./helpers.js";

/** 第 1 局：先翻一张宝物再连出两张同种危险塌方（神器没翻出来）。 */
function collapseRound(g: GameState, hazard: "fire" | "snake" | "mummy" | "rocks" | "spider", gems = 5): GameState {
	let s = step(g, gems);
	s = step(s, hazard);
	s = reveal(s, hazard);
	if (s.phase !== "roundEnd") throw new Error(`没有塌方：${s.phase}`);
	return s;
}

describe("规则核对 · 补充用例 S1–S9", () => {
	it("补充#S1 神器没翻出来就塌方 → 留在牌堆；第 2 局 15 + 14 + 2 = 31 张（E1）", () => {
		let g = newGame(4);
		g = step(g, 5);
		g = step(g, "snake");
		g = step(g, 7);
		g = step(g, 9);
		g = reveal(g, "snake");
		expect(g.phase).toBe("roundEnd");
		expect(g.path.length).toBe(5);
		expect(g.removed.snake).toBe(1);
		expect(g.artifactsLost).toEqual([]);
		expect(g.history.at(-1)!.artifactsDiscarded).toEqual([]);
		g = advance(g).state;
		expect(g.round).toBe(2);
		expect(g.deckCount).toBe(31);
		expect(g.deckArtifacts).toBe(2);
		expect(
			g.deck
				.filter((c) => c.kind === "artifact")
				.map((c) => (c.kind === "artifact" ? c.artifact : 0))
				.sort(),
		).toEqual([1, 2]);
		expect(deckInfo(g)).toMatchObject({ total: 31, artifacts: 2 });
	});

	it("补充#S2 作废的神器不占序号：第 1 局神器作废，第 2 局单独带出的算第 1 件、5 分（E3）", () => {
		let g = newGame(4);
		g = step(g, 3);
		g = step(g, "A1", { p1: "leave", p2: "leave" }); // 甲乙同走，神器留路上
		expect(g.pathArtifacts).toEqual([1]);
		g = step(g, "fire");
		g = reveal(g, "fire"); // 丙丁困住，神器作废
		expect(g.phase).toBe("roundEnd");
		expect(g.artifactsLost).toEqual([1]);
		expect(g.artifactsClaimed).toBe(0);
		g = advance(g).state;
		expect(g.deckArtifacts).toBe(1); // 只剩新放的第 2 件
		g = step(g, 4);
		g = step(g, "A2", { p4: "leave" });
		const p4 = player(g, "p4");
		expect(p4.artifacts).toEqual([{ artifact: 2, order: 1, value: 5, round: 2 }]);
		expect(g.artifactsClaimed).toBe(1);
	});

	it("补充#S3 已带出 2 件、路上 2 件，乙单独离开 → 第 3 件 5 分 + 第 4 件 10 分 = 15 分", () => {
		let g = buildScene({
			players: 4,
			round: 4,
			claimsBefore: [
				{ player: "p1", artifact: 1, round: 1 },
				{ player: "p3", artifact: 2, round: 2 },
			],
			path: [5, "A3", "A4"],
		});
		expect(g.phase).toBe("decide");
		expect(g.artifactsClaimed).toBe(2);
		expect([...g.pathArtifacts].sort()).toEqual([3, 4]);
		g = decide(g, { p2: "leave" });
		const arts = player(g, "p2").artifacts;
		expect(arts.map((a) => a.order).sort()).toEqual([3, 4]);
		for (const a of arts) expect(a.value).toBe(a.order <= 3 ? 5 : 10);
		expect(arts.every((a) => a.round === 4)).toBe(true);
		expect(scoreLine(player(g, "p2")).artifactPoints).toBe(15);
		expect(g.artifactsClaimed).toBe(4);
		expect(g.pathArtifacts).toEqual([]);
		const [left] = eventsOf(g, "PlayersLeft");
		expect(left!.artifacts.map((a) => a.order).sort()).toEqual([3, 4]);
		const [dep] = g.departures.filter((d) => d.round === 4 && d.players.includes("p2"));
		expect(dep!.artifacts.length).toBe(2);
	});

	it("补充#S4 同种危险被移出两次（E2）：第 3 局火焰只剩 1 张，出现时不算塌方概率", () => {
		let g = newGame(3);
		g = collapseRound(g, "fire");
		expect(g.removed.fire).toBe(1);
		g = advance(g).state;
		expect(g.deckCount).toBe(15 + 14 + 2);
		g = collapseRound(g, "fire");
		expect(g.removed.fire).toBe(2);
		const [col] = eventsOf(g, "Collapse");
		expect(col!.removedNow).toBe(2);
		g = advance(g).state;
		expect(g.round).toBe(3);
		// 15 宝物 + 火焰 1 + 其他 12 + 牌堆里的神器 3 件（前两局都没翻出来）
		expect(g.deckArtifacts).toBe(3);
		expect(g.deckCount).toBe(15 + 13 + 3);
		expect(g.deck.filter((c) => c.kind === "hazard" && c.hazard === "fire").length).toBe(1);
		expect(deckInfo(g).hazards).toEqual({ fire: 1, mummy: 3, rocks: 3, snake: 3, spider: 3 });
		g = step(g, 5);
		g = reveal(g, "fire");
		expect(g.phase).toBe("decide");
		// 火焰已经没有了，下一张不可能因为火焰塌方
		expect(bustChance(g)).toBe(0);
		expect(deckInfo(g).hazards.fire).toBe(0);
		// 再出一种危险：P = (3-1)/R
		g = decide(g);
		g = reveal(g, "mummy");
		expect(bustChance(g)).toBeCloseTo(2 / g.deckCount, 10);
	});

	it("补充#S5 局末余数作废（E4）：p=3 三人同走各 1；p=2 三人同走各 0，局末清零", () => {
		let g = step(newGame(3), 11); // 各 3 余 2
		g = step(g, 13, {}, "leave"); // 各 4 余 1 → p=3，三人同走
		expect(g.pathGems).toBe(0);
		for (const id of ["p1", "p2", "p3"]) expect(tent(g, id)).toBe(8);
		g = advanceUntil(g, "roundEnd");
		expect(g.history.at(-1)).toMatchObject({ reason: "allLeft", pathGemsDiscarded: 0, caught: [] });

		let h = step(newGame(3), 11, {}, "leave"); // 各 3 余 2，三人同走，每人 0
		expect(h.pathGems).toBe(2);
		for (const id of ["p1", "p2", "p3"]) expect(tent(h, id)).toBe(3);
		h = advanceUntil(h, "roundEnd");
		expect(h.history.at(-1)!.pathGemsDiscarded).toBe(2);
		h = advance(h).state;
		expect(h.round).toBe(2);
		expect(h.pathGems).toBe(0);
		for (const id of ["p1", "p2", "p3"]) expect(tent(h, id)).toBe(3);
	});

	it("补充#S5 塌方时路上的余数也作废，下一局从 0 开始（E4）", () => {
		let g = step(newGame(4), 11); // 各 2 余 3
		g = step(g, "rocks");
		g = reveal(g, "rocks");
		expect(g.phase).toBe("roundEnd");
		expect(g.history.at(-1)!.pathGemsDiscarded).toBe(3);
		g = advance(g).state;
		expect(g.pathGems).toBe(0);
	});

	it("补充#S6 甲乙先后单独离开（路上没神器），之后翻出神器只剩丙，丙离开拿走", () => {
		let g = step(newGame(3), 7, { p1: "leave" }); // 各 2 余 1；甲 2+1
		expect(tent(g, "p1")).toBe(3);
		expect(player(g, "p1").artifacts).toEqual([]);
		g = step(g, 9, { p2: "leave" }); // 乙丙各 4 余 1；乙 6+1
		expect(tent(g, "p2")).toBe(7);
		expect(player(g, "p2").artifacts).toEqual([]);
		g = step(g, "A1", { p3: "leave" });
		expect(tent(g, "p3")).toBe(6);
		expect(player(g, "p3").artifacts).toEqual([{ artifact: 1, order: 1, value: 5, round: 1 }]);
		g = advanceUntil(g, "roundEnd");
		expect(g.history.at(-1)).toMatchObject({ reason: "allLeft", artifactsDiscarded: [] });
		expect(g.artifactsLost).toEqual([]);
	});

	it("补充#S7 最后两人同时离开、路上有神器 → 都拿不到；局末神器作废，下一局牌堆没有它", () => {
		let g = step(newGame(4), 5, { p1: "leave", p2: "leave" });
		g = step(g, "A1", { p3: "leave", p4: "leave" });
		expect(player(g, "p3").artifacts).toEqual([]);
		expect(player(g, "p4").artifacts).toEqual([]);
		g = advanceUntil(g, "roundEnd");
		expect(g.history.at(-1)).toMatchObject({ reason: "allLeft", artifactsDiscarded: [1] });
		expect(g.artifactsLost).toEqual([1]);
		g = advance(g).state;
		expect(g.deckArtifacts).toBe(1);
		expect(g.deckCount).toBe(31);
		expect(g.deck.some((c) => c.kind === "artifact" && c.artifact === 1)).toBe(false);
	});

	it("补充#S8 先走的人安全：甲 3 颗；乙丙 4 颗塌方清零，火焰移出 1 张", () => {
		let g = step(newGame(3), 7, { p1: "leave" });
		expect(tent(g, "p1")).toBe(3);
		expect(g.pathGems).toBe(0);
		g = step(g, "fire");
		g = step(g, 4);
		expect(carried(g, "p2")).toBe(4);
		expect(carried(g, "p3")).toBe(4);
		expect(g.pathGems).toBe(0);
		g = reveal(g, "fire");
		expect(g.phase).toBe("roundEnd");
		const [col] = eventsOf(g, "Collapse");
		expect(col!.lostGems).toBe(4);
		expect([...col!.caught].sort()).toEqual(["p2", "p3"]);
		expect(carried(g, "p2")).toBe(0);
		expect(tent(g, "p1")).toBe(3);
		expect(tent(g, "p2")).toBe(0);
		expect(g.removed.fire).toBe(1);
		// 被困的人局末仍标在神庙里（界面画「被困」），先走的人不是
		expect(player(g, "p2").inTemple).toBe(true);
		expect(player(g, "p1").inTemple).toBe(false);
	});

	it("补充#S9 同一时刻还在神庙里的人携带宝石相等（多批离开后也一样）", () => {
		let g = step(newGame(5), 13, { p1: "leave" }); // 各 2 余 3；甲 2+3
		const check = (s: GameState) => {
			const inT = s.players.filter((p) => p.inTemple).map((p) => p.carried);
			expect(new Set(inT).size).toBeLessThanOrEqual(1);
		};
		check(g);
		g = step(g, 9, { p2: "leave", p3: "leave" }); // 4 人各 2 余 1；乙丙各 4+0
		check(g);
		g = step(g, 15);
		check(g);
		expect(carried(g, "p4")).toBe(2 + 2 + 7);
	});
});

describe("规则核对 · 勘误和拍板", () => {
	it("E1 神器跨局保留：一局路上出现两件，最后一人单独离开一次全拿（第 1、2 件各 5 分）", () => {
		let g = collapseRound(newGame(3), "snake"); // 第 1 件没翻出来
		g = advance(g).state;
		expect(g.deckArtifacts).toBe(2);
		g = step(g, "A1");
		g = step(g, 3, { p1: "leave", p2: "leave" }); // 各 1 余 0，甲乙同走，神器留路上
		expect(g.pathArtifacts).toEqual([1]);
		g = reveal(g, "A2");
		expect([...g.pathArtifacts].sort()).toEqual([1, 2]);
		g = decide(g, { p3: "leave" });
		const arts = player(g, "p3").artifacts;
		expect(arts.length).toBe(2);
		expect(arts.map((a) => a.order).sort()).toEqual([1, 2]);
		expect(arts.map((a) => a.value)).toEqual([5, 5]);
		expect(g.artifactsClaimed).toBe(2);
		g = advanceUntil(g, "roundEnd");
		g = advance(g).state;
		expect(g.round).toBe(3);
		expect(g.deckArtifacts).toBe(1); // 只有第 3 件
	});

	it("E1 牌堆里的神器数 = 局数 − 已翻出过的神器", () => {
		let g = newGame(3);
		for (let r = 1; r <= 3; r++) {
			expect(g.deckArtifacts).toBe(r);
			g = collapseRound(g, (["fire", "snake", "mummy"] as const)[r - 1]!);
			g = advance(g).state;
		}
		expect(g.round).toBe(4);
		expect(g.deckArtifacts).toBe(4);
		// 15 宝物 + 15 − 3 危险 + 4 神器
		expect(g.deckCount).toBe(15 + 12 + 4);
	});

	it("一次带出 3 件跨过分值线：已带出 2 件，第 5 局路上 3 件 → 5 + 10 + 10", () => {
		let g = buildScene({
			players: 3,
			round: 5,
			claimsBefore: [
				{ player: "p1", artifact: 1, round: 1 },
				{ player: "p2", artifact: 2, round: 2 },
			],
			path: [5, "A3", "A4", "A5"],
		});
		expect(g.phase).toBe("decide");
		g = decide(g, { p3: "leave" });
		const arts = player(g, "p3").artifacts;
		expect(arts.map((a) => a.order).sort()).toEqual([3, 4, 5]);
		expect(arts.map((a) => a.value).sort((a, b) => a - b)).toEqual([5, 10, 10]);
		expect(scoreLine(player(g, "p3")).artifactPoints).toBe(25);
		expect(g.artifactsClaimed).toBe(5);
	});

	it("神器分值看带出顺序，不看局数、不看神器编号：第 5 局带出的第 5 号神器若是第 1 件，只值 5 分", () => {
		let g = newGame(3);
		for (let r = 1; r <= 4; r++) {
			g = step(g, `A${r}` as const);
			g = step(g, 2, {}, "leave"); // 全员同走，神器作废
			g = advanceUntil(g, "roundEnd");
			g = advance(g).state;
		}
		expect(g.artifactsLost).toEqual([1, 2, 3, 4]);
		g = step(g, "A5", { p1: "leave" });
		expect(player(g, "p1").artifacts).toEqual([{ artifact: 5, order: 1, value: 5, round: 5 }]);
	});

	it("E5 塌方时路上的神器作废，牌堆里没翻出的神器保留", () => {
		let g = collapseRound(newGame(3), "spider"); // 第 1 件留在牌堆
		g = advance(g).state;
		g = step(g, 3);
		g = step(g, "A2");
		g = step(g, "mummy");
		g = reveal(g, "mummy");
		expect(g.phase).toBe("roundEnd");
		expect(g.artifactsLost).toEqual([2]);
		expect(g.history.at(-1)!.artifactsDiscarded).toEqual([2]);
		g = advance(g).state;
		expect(g.deckArtifacts).toBe(2); // 第 1 件 + 第 3 件
		expect(
			g.deck
				.filter((c) => c.kind === "artifact")
				.map((c) => (c.kind === "artifact" ? c.artifact : 0))
				.sort(),
		).toEqual([1, 3]);
	});

	it("E10 / 拍板：一局第一张是危险 → 不决定，直接翻下一张，弹提示", () => {
		let g = newGame(4);
		const t0 = g.turn;
		g = reveal(g, "spider");
		expect(g.phase).toBe("skip");
		expect(eventsOf(g, "FirstHazardSkipped")).toEqual([{ type: "FirstHazardSkipped", hazard: "spider" }]);
		expect(eventsOf(g, "CardRevealed")[0]).toMatchObject({ first: true, index: 0 });
		expect(g.turn).toBe(t0);
		for (const p of g.players) {
			expect(legalActions(g, p.id)).toEqual([]);
			expect(p.decided).toBe(false);
		}
		expect(() => apply(g, "p1", { type: "decide", choice: "leave" })).toThrow();
		g = reveal(g, 5);
		expect(g.phase).toBe("decide");
		expect(g.turn).toBe(t0 + 1);
		expect(g.path.length).toBe(2);
		expect(carried(g, "p1")).toBe(1);
	});

	it("E10：第一张危险、第二张同种 → 直接塌方（没人做过决定）", () => {
		let g = reveal(newGame(3), "rocks");
		g = reveal(g, "rocks");
		expect(g.phase).toBe("roundEnd");
		expect(g.removed.rocks).toBe(1);
		expect(g.history.at(-1)).toMatchObject({ reason: "collapse", hazard: "rocks", lostGems: 0, cards: 2 });
	});

	it("E10 只管第一张：第一张是宝物或神器照常决定；第二张才出现的危险也照常决定", () => {
		let g = reveal(newGame(3), "A1");
		expect(g.phase).toBe("decide");
		g = reveal(newGame(3), 1);
		expect(g.phase).toBe("decide");
		g = decide(g);
		g = reveal(g, "fire");
		expect(g.phase).toBe("decide");
		// 新一局第一张是危险也跳过（不只第 1 局）
		let h = collapseRound(newGame(3), "snake");
		h = advance(h).state;
		h = reveal(h, "fire");
		expect(h.phase).toBe("skip");
	});

	it("拍板：「无神器」开房选项 → 牌堆 30 张、整局不出神器", () => {
		const g = newGame(4, 3, { noArtifacts: true });
		expect(g.config.noArtifacts).toBe(true);
		expect(g.deckCount).toBe(30);
		expect(g.deck.length).toBe(30);
		expect(g.deckArtifacts).toBe(0);
		expect(g.deck.some((c) => c.kind === "artifact")).toBe(false);
		const [started] = eventsOf(g, "RoundStarted");
		if (started) expect(started.newArtifact).toBeNull();
		// 塌方一次后第 2 局 29 张，仍然没有神器
		let h = collapseRound(g, "fire");
		h = advance(h).state;
		expect(h.deckCount).toBe(29);
		expect(h.deckArtifacts).toBe(0);
		expect(eventsOf(h, "RoundStarted")[0]!.newArtifact).toBeNull();
	});

	it("拍板：「无神器」默认关", () => {
		const g = newGame(3);
		expect(g.config.noArtifacts).toBe(false);
		expect(g.deckArtifacts).toBe(1);
	});
});
