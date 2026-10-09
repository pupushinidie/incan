/**
 * 规则核对（背靠背）：规则书第 9 节测试用例 TC1–TC12，按规则书原文 + 补充勘误 + 开工拍板写，不看引擎实现。
 */
import { describe, expect, it } from "vitest";
import {
	advance,
	apply,
	artifactValue,
	buildDeck,
	buildScene,
	createGame,
	HAZARD_TYPES,
	legalActions,
	noneRemoved,
	scoreLine,
	TREASURES,
	type Card,
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
	seats,
	step,
	sum,
	tent,
} from "./helpers.js";

function countKinds(cards: readonly Card[]) {
	const treasures = cards.filter((c) => c.kind === "treasure").map((c) => (c.kind === "treasure" ? c.gems : 0));
	const hazards: Record<string, number> = {};
	for (const c of cards) if (c.kind === "hazard") hazards[c.hazard] = (hazards[c.hazard] ?? 0) + 1;
	const artifacts = cards.filter((c) => c.kind === "artifact").length;
	return { treasures, hazards, artifacts };
}

describe("规则核对 · 规则书 TC1–TC12", () => {
	it("规则书#TC1 宝物卡 15 张，面值 1,2,3,4,5,5,7,7,9,11,11,13,14,15,17，合计 124", () => {
		expect([...TREASURES].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17]);
		expect(TREASURES.length).toBe(15);
		expect(sum(TREASURES)).toBe(124);
		// 牌堆里的宝物也是这一组
		const { treasures } = countKinds(buildDeck(noneRemoved(), 1));
		expect(treasures.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17]);
	});

	it("规则书#TC2 危险 5 种 × 3 张；第 1 局牌堆 15+15+1 = 31 张", () => {
		expect([...HAZARD_TYPES].sort()).toEqual(["fire", "mummy", "rocks", "snake", "spider"]);
		const deck = buildDeck(noneRemoved(), 1);
		expect(deck.length).toBe(31);
		const k = countKinds(deck);
		expect(k.hazards).toEqual({ fire: 3, mummy: 3, rocks: 3, snake: 3, spider: 3 });
		expect(k.artifacts).toBe(1);
		// 开局的真实牌堆也是 31 张、1 件神器
		const g = newGame(4);
		expect(g.phase).toBe("start");
		expect(g.round).toBe(1);
		expect(g.deckCount).toBe(31);
		expect(g.deck.length).toBe(31);
		expect(g.deckArtifacts).toBe(1);
		expect(countKinds(g.deck).hazards).toEqual({ fire: 3, mummy: 3, rocks: 3, snake: 3, spider: 3 });
	});

	it("规则书#TC3 4 人在神庙翻出 11 → 每人携带 +2，路径余数 +3", () => {
		const g = reveal(newGame(4), 11);
		expect(g.phase).toBe("decide");
		for (const id of ["p1", "p2", "p3", "p4"]) expect(carried(g, id)).toBe(2);
		expect(g.pathGems).toBe(3);
		const [ev] = eventsOf(g, "CardRevealed");
		expect(ev).toMatchObject({ inTemple: 4, share: 2, remainder: 3 });
	});

	it("规则书#TC4 余数 3、2 人同时离开 → 每人 +1，余数剩 1", () => {
		let g = reveal(newGame(4), 11);
		g = decide(g, { p1: "leave", p2: "leave" });
		expect(g.phase).toBe("reveal");
		expect(g.pathGems).toBe(1);
		// 落袋：携带 2 + 分到 1
		expect(tent(g, "p1")).toBe(3);
		expect(tent(g, "p2")).toBe(3);
		expect(player(g, "p1").inTemple).toBe(false);
		expect(carried(g, "p1")).toBe(0);
		// 留下的人不变
		expect(carried(g, "p3")).toBe(2);
		expect(tent(g, "p3")).toBe(0);
		const [left] = eventsOf(g, "PlayersLeft");
		expect(left).toMatchObject({ carried: 2, share: 1, pathGemsBefore: 3, pathGemsAfter: 1 });
		expect([...left!.players].sort()).toEqual(["p1", "p2"]);
	});

	it("规则书#TC5 路径上 1 件神器、只有甲离开 → 甲拿到第 1 件（5 分）", () => {
		let g = step(newGame(3), 7); // 每人 2，余 1，都继续
		g = reveal(g, "A1");
		expect(g.pathArtifacts).toEqual([1]);
		expect(g.artifactsClaimed).toBe(0);
		g = decide(g, { p1: "leave" });
		const p1 = player(g, "p1");
		expect(p1.artifacts).toEqual([{ artifact: 1, order: 1, value: 5, round: 1 }]);
		expect(g.artifactsClaimed).toBe(1);
		expect(g.pathArtifacts).toEqual([]);
		expect(tent(g, "p1")).toBe(3); // 携带 2 + 余数 1
		expect(g.pathGems).toBe(0);
		expect(scoreLine(p1).artifactPoints).toBe(5);
		expect(scoreLine(p1).total).toBe(3 + 5);
	});

	it("规则书#TC6 路径上 1 件神器、甲乙同时离开 → 神器留在路径；丙丁继续", () => {
		let g = step(newGame(4), 9); // 每人 2，余 1
		g = reveal(g, "A1");
		g = decide(g, { p1: "leave", p2: "leave" });
		expect(g.pathArtifacts).toEqual([1]);
		expect(player(g, "p1").artifacts).toEqual([]);
		expect(player(g, "p2").artifacts).toEqual([]);
		expect(g.artifactsClaimed).toBe(0);
		expect(player(g, "p3").inTemple).toBe(true);
		expect(player(g, "p4").inTemple).toBe(true);
		const [left] = eventsOf(g, "PlayersLeft");
		expect(left!.artifacts).toEqual([]);
		// 规则书 4.4：之后若有一人单独离开，他可拿走
		g = step(g, 4, { p3: "leave" }); // 丙丁各 2
		expect(player(g, "p3").artifacts.map((a) => a.artifact)).toEqual([1]);
		expect(g.pathArtifacts).toEqual([]);
	});

	it("规则书#TC7 第二次同种危险 → 塌方：携带清零、火焰永久移出 1 张、路径神器作废；第 2 局 15+14+1 = 30 张", () => {
		let g = step(newGame(4), 5); // 每人 1，余 1
		g = step(g, "A1");
		g = step(g, "fire"); // 第一次出现：没事，大家继续
		expect(g.phase).toBe("reveal");
		g = reveal(g, "fire");
		expect(g.phase).toBe("roundEnd");
		for (const id of ["p1", "p2", "p3", "p4"]) {
			expect(carried(g, id)).toBe(0);
			expect(tent(g, id)).toBe(0);
		}
		expect(g.removed).toEqual({ fire: 1, mummy: 0, rocks: 0, snake: 0, spider: 0 });
		expect(g.pathArtifacts).toEqual([]);
		expect(g.artifactsLost).toEqual([1]);
		expect(g.artifactsClaimed).toBe(0);
		const [col] = eventsOf(g, "Collapse");
		expect(col).toMatchObject({ hazard: "fire", lostGems: 1, removedNow: 1 });
		expect([...col!.caught].sort()).toEqual(["p1", "p2", "p3", "p4"]);
		const r = g.history.at(-1)!;
		expect(r).toMatchObject({ round: 1, reason: "collapse", hazard: "fire", lostGems: 1, artifactsDiscarded: [1] });

		// 第 2 局：火焰只剩 2 张；第 1 局的神器翻出来作废了，牌堆里只有新放的第 2 件
		const deck2 = buildDeck({ ...noneRemoved(), fire: 1 }, [2]);
		expect(deck2.length).toBe(30);
		expect(countKinds(deck2).hazards.fire).toBe(2);
		g = advance(g).state;
		expect(g.round).toBe(2);
		expect(g.phase).toBe("start");
		expect(g.deckCount).toBe(30);
		expect(g.deckArtifacts).toBe(1);
		expect(countKinds(g.deck).hazards).toEqual({ fire: 2, mummy: 3, rocks: 3, snake: 3, spider: 3 });
		expect(g.deck.filter((c) => c.kind === "artifact")).toEqual([{ kind: "artifact", artifact: 2 }]);
		const [started] = eventsOf(g, "RoundStarted");
		expect(started).toMatchObject({ round: 2, deckCount: 30, deckArtifacts: 1, newArtifact: 2 });
	});

	it("规则书#TC8 提前离开的人安全；塌方只清神庙里的人（见 S8 的具体牌序）", () => {
		let g = step(newGame(3), 5, { p1: "leave" }); // 每人 1 余 2；甲独走 1+2=3
		expect(tent(g, "p1")).toBe(3);
		g = step(g, "fire");
		g = step(g, 9); // 乙丙各 4 余 1
		g = reveal(g, "fire");
		expect(g.phase).toBe("roundEnd");
		expect(tent(g, "p1")).toBe(3);
		expect(tent(g, "p2")).toBe(0);
		expect(tent(g, "p3")).toBe(0);
		g = advance(g).state;
		expect(tent(g, "p1")).toBe(3);
	});

	it("规则书#TC9 神器分值按带出顺序：5, 5, 5, 10, 10", () => {
		expect([1, 2, 3, 4, 5].map(artifactValue)).toEqual([5, 5, 5, 10, 10]);
	});

	it("规则书#TC10 甲 23 宝石 + 第 2、5 件神器 = 38 分；乙 30 宝石 = 30 分；甲胜", () => {
		const g = buildScene({
			players: 3,
			phase: "gameOver",
			tentsBefore: { p1: 23, p2: 30, p3: 0 },
			claimsBefore: [
				{ player: "p3", artifact: 1 },
				{ player: "p1", artifact: 2 },
				{ player: "p3", artifact: 3 },
				{ player: "p3", artifact: 4 },
				{ player: "p1", artifact: 5 },
			],
		});
		const p1 = player(g, "p1");
		expect(p1.artifacts.map((a) => [a.order, a.value])).toEqual([
			[2, 5],
			[5, 10],
		]);
		expect(scoreLine(p1)).toMatchObject({ gems: 23, artifactPoints: 15, total: 38 });
		expect(scoreLine(player(g, "p2"))).toMatchObject({ gems: 30, artifactPoints: 0, total: 30 });
		expect(scoreLine(player(g, "p3"))).toMatchObject({ gems: 0, artifactPoints: 20, total: 20 });
		expect(g.finalResult!.winners).toEqual(["p1"]);
		expect(g.finalResult!.scores.map((s) => s.player)).toEqual(["p1", "p2", "p3"]);
		expect(g.finalResult!.scores.map((s) => s.rank)).toEqual([1, 2, 3]);
	});

	it("规则书#TC11 5 局打完 → gameOver；总分并列且神器件数相同 → 并列获胜", () => {
		// 每局：翻出本局神器（大家都继续），再翻一张宝物，全员一起离开 → 神器都作废
		const plan = [15, 14, 13, 11, 17];
		let g = newGame(3);
		for (let r = 1; r <= 5; r++) {
			expect(g.round).toBe(r);
			expect(g.phase).toBe("start");
			g = step(g, `A${r}` as const);
			g = step(g, plan[r - 1]!, {}, "leave");
			g = advanceUntil(g, "roundEnd");
			expect(g.round).toBe(r);
			if (r < 5) g = advance(g).state;
		}
		expect(g.artifactsLost).toEqual([1, 2, 3, 4, 5]);
		g = advance(g).state;
		expect(g.phase).toBe("gameOver");
		expect(g.round).toBe(5);
		expect(eventsOf(g, "GameEnded").length).toBe(1);
		// 15/3=5, 14/3=4, 13/3=4, 11/3=3, 17/3=5 → 每人 21，没人有神器
		for (const id of ["p1", "p2", "p3"]) expect(tent(g, id)).toBe(21);
		expect([...g.finalResult!.winners].sort()).toEqual(["p1", "p2", "p3"]);
		expect(g.finalResult!.scores.every((s) => s.rank === 1 && s.total === 21)).toBe(true);
		// 终局后不能再推进、不能再下命令
		expect(() => advance(g)).toThrow();
		expect(() => apply(g, "p1", { type: "decide", choice: "stay" })).toThrow();
	});

	it("规则书#TC11 同分比神器件数（比件数，不是比神器分）", () => {
		// 甲：15 宝石 + 第 4 件（10 分）= 25，1 件；乙：15 宝石 + 第 1、2 件（5+5）= 25，2 件 → 乙胜
		const g = buildScene({
			players: 3,
			phase: "gameOver",
			tentsBefore: { p1: 15, p2: 15, p3: 24 },
			claimsBefore: [
				{ player: "p2", artifact: 1 },
				{ player: "p2", artifact: 2 },
				{ player: "p3", artifact: 3 },
				{ player: "p1", artifact: 4 },
			],
		});
		expect(scoreLine(player(g, "p1")).total).toBe(25);
		expect(scoreLine(player(g, "p2")).total).toBe(25);
		expect(scoreLine(player(g, "p3")).total).toBe(29);
		expect(g.finalResult!.winners).toEqual(["p3"]);
		const rank = Object.fromEntries(g.finalResult!.scores.map((s) => [s.player, s.rank]));
		expect(rank.p3).toBe(1);
		expect(rank.p2).toBe(2);
		expect(rank.p1).toBe(3);
		expect(g.finalResult!.scores.map((s) => s.player)).toEqual(["p3", "p2", "p1"]);

		// 最高分并列：件数多者独胜
		const h = buildScene({
			players: 3,
			phase: "gameOver",
			tentsBefore: { p1: 15, p2: 15, p3: 3 },
			claimsBefore: [
				{ player: "p2", artifact: 1 },
				{ player: "p2", artifact: 2 },
				{ player: "p3", artifact: 3 },
				{ player: "p1", artifact: 4 },
			],
		});
		expect(h.finalResult!.winners).toEqual(["p2"]);
	});

	it("规则书#TC12 决定校验：不在神庙里、已翻下一张、值不对 → 拒绝", () => {
		let g = step(newGame(3), 7, { p1: "leave" });
		g = reveal(g, 9);
		expect(g.phase).toBe("decide");
		// 不在神庙里的人
		expect(() => apply(g, "p1", { type: "decide", choice: "stay", turn: g.turn })).toThrow();
		expect(legalActions(g, "p1")).toEqual([]);
		// 值不是 stay / leave
		expect(() => apply(g, "p2", { type: "decide", choice: "maybe", turn: g.turn } as never)).toThrow();
		// 上一张牌的决定（turn 过期）
		const oldTurn = g.turn - 1;
		expect(() => apply(g, "p2", { type: "decide", choice: "stay", turn: oldTurn })).toThrow();
		// 全员决定、已经翻下一张后，拿旧 turn 再发
		const turnBefore = g.turn;
		g = decide(g);
		g = reveal(g, 3);
		expect(g.phase).toBe("decide");
		expect(g.turn).not.toBe(turnBefore);
		expect(() => apply(g, "p2", { type: "decide", choice: "leave", turn: turnBefore })).toThrow();
		// 不在座位上的人
		expect(() => apply(g, "nobody", { type: "decide", choice: "stay" })).toThrow();
		// 未知命令
		expect(() => apply(g, "p2", { type: "nextRound" } as never)).toThrow();
	});
});

describe("规则核对 · 开局", () => {
	it("规则书 §3/§7：3–8 人；2 人、9 人开不了", () => {
		for (let n = 3; n <= 8; n++) {
			const g = createGame(seats(n), 1);
			expect(g.players.length).toBe(n);
			expect(g.players.every((p) => p.inTemple && p.carried === 0 && p.tent === 0 && p.artifacts.length === 0)).toBe(true);
			expect(g.pathGems).toBe(0);
			expect(g.path).toEqual([]);
			expect(g.removed).toEqual(noneRemoved());
			expect(g.config.rounds).toBe(5);
		}
		expect(() => createGame(seats(2), 1)).toThrow();
		expect(() => createGame(seats(9), 1)).toThrow();
	});

	it("规则书 §3.4 / E10：第一张翻牌前不用决定（start 阶段发命令被拒绝）", () => {
		const g: GameState = newGame(4);
		expect(g.phase).toBe("start");
		expect(legalActions(g, "p1")).toEqual([]);
		expect(() => apply(g, "p1", { type: "decide", choice: "leave" })).toThrow();
	});
});
