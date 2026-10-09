/**
 * 规则核对（背靠背）：规则书 §4 的边界情况、决定流程（同时决定、改选、撤回、超时）、局与局之间的重置。
 */
import { describe, expect, it } from "vitest";
import {
	advance,
	apply,
	bustChance,
	buildScene,
	deckInfo,
	legalActions,
	pendingDeciders,
	timeoutTurn,
	timerKey,
	timerMs,
	type GameState,
} from "../../src/index.js";
import {
	advanceUntil,
	carried,
	decide,
	deepFreeze,
	eventsOf,
	newGame,
	player,
	reveal,
	step,
	sum,
	tent,
} from "./helpers.js";

describe("规则核对 · 宝石平分和余数（§4.1 / §4.2 / §4.4）", () => {
	it("余数连续累积：4 人翻 11、13、2 → 携带 5，路上 6；四人同走各 +1、路上剩 2", () => {
		let g = step(newGame(4), 11); // 2 余 3
		g = step(g, 13); // 3 余 1 → 4
		g = reveal(g, 2); // 0 余 2 → 6
		expect(eventsOf(g, "CardRevealed")[0]).toMatchObject({ share: 0, remainder: 2 });
		for (const id of ["p1", "p2", "p3", "p4"]) expect(carried(g, id)).toBe(5);
		expect(g.pathGems).toBe(6);
		g = decide(g, {}, "leave");
		for (const id of ["p1", "p2", "p3", "p4"]) expect(tent(g, id)).toBe(6);
		expect(g.pathGems).toBe(2);
	});

	it("8 人：17 → 每人 2 余 1；1 → 每人 0 余 1", () => {
		let g = reveal(newGame(8), 17);
		expect(g.players.every((p) => p.carried === 2)).toBe(true);
		expect(g.pathGems).toBe(1);
		g = decide(g);
		g = reveal(g, 1);
		expect(g.players.every((p) => p.carried === 2)).toBe(true);
		expect(g.pathGems).toBe(2);
	});

	it("多批离开：5 人分三批走，每批按当时人数分余数，局末剩的余数作废", () => {
		let g = step(newGame(5), 11, { p1: "leave", p2: "leave" }); // 5 人各 2 余 1；甲乙各 0，剩 1
		expect(tent(g, "p1")).toBe(2);
		expect(tent(g, "p2")).toBe(2);
		expect(g.pathGems).toBe(1);
		g = step(g, 9, { p3: "leave" }); // 3 人各 3 余 0；丙独走 2+3+1
		expect(tent(g, "p3")).toBe(6);
		expect(g.pathGems).toBe(0);
		g = step(g, 15, {}, "leave"); // 2 人各 7 余 1；丁戊同走各 0
		expect(tent(g, "p4")).toBe(12);
		expect(tent(g, "p5")).toBe(12);
		expect(g.pathGems).toBe(1);
		g = advanceUntil(g, "roundEnd");
		expect(g.history.at(-1)).toMatchObject({ reason: "allLeft", pathGemsDiscarded: 1, cards: 3 });
		// 离开记录：公开，按批次
		const deps = g.departures.filter((d) => d.round === 1);
		expect(deps.map((d) => [d.after, [...d.players].sort()])).toEqual([
			[1, ["p1", "p2"]],
			[2, ["p3"]],
			[3, ["p4", "p5"]],
		]);
		expect(player(g, "p3").leftAfter).toBe(2);
	});

	it("单独离开但路上没神器：只落袋宝石", () => {
		const g = step(newGame(3), 14, { p2: "leave" }); // 各 4 余 2；乙 4+2
		expect(tent(g, "p2")).toBe(6);
		expect(player(g, "p2").artifacts).toEqual([]);
		expect(eventsOf(g, "PlayersLeft")[0]!.artifacts).toEqual([]);
	});

	it("只剩一个人时独得整张宝物，也会独自塌方", () => {
		let g = step(newGame(3), 2, { p1: "leave", p2: "leave" }); // 各 0 余 2；甲乙各 1
		expect(tent(g, "p1")).toBe(1);
		expect(g.pathGems).toBe(0);
		g = step(g, 13);
		expect(carried(g, "p3")).toBe(13);
		g = step(g, "fire");
		g = reveal(g, "fire");
		expect(g.phase).toBe("roundEnd");
		expect(eventsOf(g, "Collapse")[0]).toMatchObject({ caught: ["p3"], lostGems: 13 });
		expect(tent(g, "p3")).toBe(0);
	});
});

describe("规则核对 · 同时决定（§4.2 / §8.5）", () => {
	it("决定中只公开已决定 / 未决定；最后一个人决定的那一步亮出并结算", () => {
		let g = reveal(newGame(4), 5);
		const t = g.turn;
		expect(pendingDeciders(g).sort()).toEqual(["p1", "p2", "p3", "p4"]);
		g = apply(g, "p1", { type: "decide", choice: "leave", turn: t }).state;
		expect(g.phase).toBe("decide");
		expect(player(g, "p1").decided).toBe(true);
		expect(eventsOf(g, "Decided")).toEqual([{ type: "Decided", player: "p1" }]);
		expect(pendingDeciders(g).sort()).toEqual(["p2", "p3", "p4"]);
		g = apply(g, "p2", { type: "decide", choice: "stay", turn: t }).state;
		g = apply(g, "p3", { type: "decide", choice: "stay", turn: t }).state;
		expect(g.phase).toBe("decide");
		expect(player(g, "p1").inTemple).toBe(true); // 还没亮出，不能先走
		g = apply(g, "p4", { type: "decide", choice: "stay", turn: t }).state;
		expect(g.phase).toBe("reveal");
		expect(g.events.map((e) => e.type)).toEqual(["Decided", "ChoicesRevealed", "PlayersLeft"]);
		const [rev] = eventsOf(g, "ChoicesRevealed");
		expect(rev!.leave).toEqual(["p1"]);
		expect([...rev!.stay].sort()).toEqual(["p2", "p3", "p4"]);
		expect(player(g, "p1").inTemple).toBe(false);
		expect(player(g, "p1").leftAfter).toBe(1);
		// 亮出后不能再改
		expect(() => apply(g, "p2", { type: "undecide", turn: t })).toThrow();
		expect(() => apply(g, "p2", { type: "decide", choice: "leave", turn: t })).toThrow();
	});

	it("最后一个人确认前可以改选、撤回；改选以最后的为准", () => {
		let g = reveal(newGame(3), 9);
		const t = g.turn;
		g = apply(g, "p1", { type: "decide", choice: "stay", turn: t }).state;
		const la = legalActions(g, "p1");
		expect(la).toContainEqual(expect.objectContaining({ type: "undecide" }));
		expect(la).toContainEqual(expect.objectContaining({ type: "decide", choice: "leave" }));
		g = apply(g, "p1", { type: "decide", choice: "leave", turn: t }).state; // 改选
		expect(player(g, "p1").choice).toBe("leave");
		g = apply(g, "p1", { type: "undecide", turn: t }).state;
		expect(player(g, "p1").decided).toBe(false);
		expect(eventsOf(g, "Undecided")).toEqual([{ type: "Undecided", player: "p1" }]);
		expect(pendingDeciders(g)).toContain("p1");
		expect(legalActions(g, "p1").filter((c) => c.type === "decide").map((c) => (c.type === "decide" ? c.choice : "")).sort()).toEqual([
			"leave",
			"stay",
		]);
		// 没决定时不能撤回
		expect(() => apply(g, "p2", { type: "undecide", turn: t })).toThrow();
		g = apply(g, "p1", { type: "decide", choice: "leave", turn: t }).state;
		g = apply(g, "p2", { type: "decide", choice: "stay", turn: t }).state;
		g = apply(g, "p3", { type: "decide", choice: "stay", turn: t }).state;
		expect(g.phase).toBe("reveal");
		expect(tent(g, "p1")).toBe(3 + 0); // 9/3=3 余 0
	});

	it("全员继续：没人离开，亮出后翻下一张", () => {
		let g = step(newGame(3), 4);
		expect(g.phase).toBe("reveal");
		expect(g.players.every((p) => p.inTemple)).toBe(true);
		expect(eventsOf(g, "PlayersLeft")).toEqual([]);
		g = reveal(g, 1);
		expect(g.phase).toBe("decide");
		// 新一轮：决定清空
		expect(g.players.every((p) => !p.decided && p.choice === null)).toBe(true);
	});

	it("离开的人这局不能再回来：之后的决定轮里没有他的命令", () => {
		let g = step(newGame(3), 5, { p1: "leave" });
		g = reveal(g, 7);
		expect(pendingDeciders(g).sort()).toEqual(["p2", "p3"]);
		expect(legalActions(g, "p1")).toEqual([]);
		expect(() => apply(g, "p1", { type: "decide", choice: "stay", turn: g.turn })).toThrow();
	});

	it("超时（§8.4 / 拍板）：30 秒，没决定的人按离开；已经决定的保留", () => {
		let g = reveal(newGame(4), 13); // 各 3 余 1
		expect(timerMs(g)).toBe(30_000);
		g = apply(g, "p1", { type: "decide", choice: "stay", turn: g.turn }).state;
		g = apply(g, "p2", { type: "decide", choice: "leave", turn: g.turn }).state;
		g = timeoutTurn(g);
		expect(g.phase).toBe("reveal");
		const [to] = eventsOf(g, "TimedOut");
		expect([...to!.players].sort()).toEqual(["p3", "p4"]);
		expect(player(g, "p1").inTemple).toBe(true);
		for (const id of ["p2", "p3", "p4"]) {
			expect(player(g, id).inTemple).toBe(false);
			expect(tent(g, id)).toBe(3); // 3 + ⌊1/3⌋
		}
		expect(g.pathGems).toBe(1);
	});

	it("非决定阶段发命令一律拒绝（reveal / roundEnd）", () => {
		let g = step(newGame(3), 5);
		expect(g.phase).toBe("reveal");
		expect(legalActions(g, "p1")).toEqual([]);
		expect(() => apply(g, "p1", { type: "decide", choice: "stay" })).toThrow();
		g = step(g, "snake");
		g = reveal(g, "snake");
		expect(g.phase).toBe("roundEnd");
		expect(() => apply(g, "p1", { type: "decide", choice: "stay" })).toThrow();
		expect(() => apply(g, "p1", { type: "undecide" })).toThrow();
	});

	it("decide 阶段不能 advance（要等人决定）", () => {
		const g = reveal(newGame(3), 5);
		expect(() => advance(g)).toThrow();
	});
});

describe("规则核对 · 局的结束和下一局", () => {
	it("全员离开后不再翻牌：下一次推进直接结束本局", () => {
		let g = step(newGame(3), 5, {}, "leave");
		const deckBefore = g.deckCount;
		const pathBefore = g.path.length;
		g = advance(g).state;
		expect(g.phase).toBe("roundEnd");
		expect(g.deckCount).toBe(deckBefore);
		expect(g.path.length).toBe(pathBefore);
		expect(eventsOf(g, "RoundEnded").length).toBe(1);
	});

	it("新一局：所有人回到神庙，携带、路径、余数、决定清空；帐篷和神器保留", () => {
		let g = step(newGame(3), 7, { p1: "leave" });
		g = step(g, "A1", { p2: "leave" });
		g = step(g, "fire");
		g = reveal(g, "fire");
		expect(g.phase).toBe("roundEnd");
		const tentsBefore = g.players.map((p) => p.tent);
		g = advance(g).state;
		expect(g.round).toBe(2);
		expect(g.phase).toBe("start");
		for (const p of g.players) {
			expect(p.inTemple).toBe(true);
			expect(p.carried).toBe(0);
			expect(p.leftAfter).toBeNull();
			expect(p.decided).toBe(false);
			expect(p.choice).toBeNull();
		}
		expect(g.players.map((p) => p.tent)).toEqual(tentsBefore);
		expect(player(g, "p2").artifacts.length).toBe(1);
		expect(g.path).toEqual([]);
		expect(g.pathGems).toBe(0);
		expect(g.pathArtifacts).toEqual([]);
		expect(g.history.length).toBe(1);
	});

	it("翻出的神器从路上被拿走后，path 里那张牌还在，pathArtifacts 去掉", () => {
		let g = step(newGame(3), "A1", { p1: "leave" });
		expect(g.path.some((c) => c.kind === "artifact")).toBe(true);
		expect(g.pathArtifacts).toEqual([]);
	});
});

describe("规则核对 · 公开的牌堆信息和概率（补充 §1.2）", () => {
	it("deckInfo / bustChance 按公开信息算：P = Σ(本局已出现的危险剩余张数) / 牌堆张数", () => {
		let g = step(newGame(4), 5);
		g = step(g, "fire");
		g = reveal(g, "snake");
		expect(g.deckCount).toBe(28);
		const info = deckInfo(g);
		expect(info.total).toBe(28);
		expect(info.hazards).toEqual({ fire: 2, mummy: 3, rocks: 3, snake: 2, spider: 3 });
		expect(info.treasureGems).toBe(124 - 5);
		expect(info.treasures.length).toBe(14);
		expect(info.artifacts).toBe(1);
		expect(bustChance(g)).toBeCloseTo(4 / 28, 10);
	});

	it("本局还没出现危险时塌方概率是 0", () => {
		const g = reveal(newGame(4), 11);
		expect(bustChance(g)).toBe(0);
	});
});

describe("规则核对 · 纯函数", () => {
	it("apply / advance / timeoutTurn 不改输入；每步 version 前进", () => {
		const g0 = deepFreeze(newGame(4));
		const g1 = reveal(g0, 5); // stackDeck + advance，输入是冻结的
		expect(g1.version).toBeGreaterThan(g0.version);
		deepFreeze(g1);
		const g2 = apply(g1, "p1", { type: "decide", choice: "stay", turn: g1.turn }).state;
		expect(g2.version).toBeGreaterThan(g1.version);
		deepFreeze(g2);
		const g3 = timeoutTurn(g2);
		expect(g3.version).toBeGreaterThan(g2.version);
		expect(player(g1, "p1").decided).toBe(false);
	});

	it("同一种子、同一串操作 → 同一局", () => {
		const run = (): GameState => {
			let g = newGame(5, 42);
			for (let i = 0; i < 6 && g.phase !== "roundEnd"; i++) {
				g = advance(g).state;
				if (g.phase === "decide") g = decide(g, { p1: i === 2 ? "leave" : "stay" });
			}
			return g;
		};
		const a = run();
		const b = run();
		expect(a.path).toEqual(b.path);
		expect(a.deck).toEqual(b.deck);
		expect(a.players).toEqual(b.players);
		expect(sum(a.players.map((p) => p.tent ?? 0))).toBe(sum(b.players.map((p) => p.tent ?? 0)));
	});
});

describe("规则核对 · 补充的边界", () => {
	it("超时的人如果是唯一离开的，也算单独离开，拿走路上的神器", () => {
		let g = step(newGame(3), 7); // 各 2 余 1
		g = reveal(g, "A1");
		g = apply(g, "p1", { type: "decide", choice: "stay", turn: g.turn }).state;
		g = apply(g, "p2", { type: "decide", choice: "stay", turn: g.turn }).state;
		g = timeoutTurn(g);
		expect(eventsOf(g, "TimedOut")[0]!.players).toEqual(["p3"]);
		expect(eventsOf(g, "ChoicesRevealed")[0]!.leave).toEqual(["p3"]);
		expect(player(g, "p3").artifacts.map((a) => a.artifact)).toEqual([1]);
		expect(tent(g, "p3")).toBe(3);
	});

	it("没人决定就超时：全员离开（多人同走，神器留路上后作废）", () => {
		let g = reveal(newGame(4), "A1");
		g = timeoutTurn(g);
		expect(g.players.every((p) => !p.inTemple)).toBe(true);
		expect(g.pathArtifacts).toEqual([1]);
		g = advanceUntil(g, "roundEnd");
		expect(g.artifactsLost).toEqual([1]);
	});

	it("命令不带 turn 时算当前这一轮", () => {
		let g = reveal(newGame(3), 5);
		g = apply(g, "p1", { type: "decide", choice: "leave" }).state;
		expect(player(g, "p1").decided).toBe(true);
	});

	it("第 n 局开局放进第 n 件神器", () => {
		let g = newGame(3);
		expect(g.deck.filter((c) => c.kind === "artifact")).toEqual([{ kind: "artifact", artifact: 1 }]);
		for (let r = 2; r <= 5; r++) {
			g = step(g, 1, {}, "leave");
			g = advanceUntil(g, "roundEnd");
			g = advance(g).state;
			expect(g.round).toBe(r);
			expect(eventsOf(g, "RoundStarted")[0]).toMatchObject({ round: r, newArtifact: r });
			expect(g.deck.some((c) => c.kind === "artifact" && c.artifact === r)).toBe(true);
		}
	});

	it("计时 key：别人决定 / 撤回不改它，翻下一张才变（不重置倒计时）", () => {
		let g = reveal(newGame(3), 5);
		const k0 = timerKey(g);
		g = apply(g, "p1", { type: "decide", choice: "stay", turn: g.turn }).state;
		expect(timerKey(g)).toBe(k0);
		g = apply(g, "p1", { type: "undecide", turn: g.turn }).state;
		expect(timerKey(g)).toBe(k0);
		g = decide(g);
		expect(timerKey(g)).not.toBe(k0);
		g = reveal(g, 7);
		expect(timerKey(g)).not.toBe(k0);
	});

	it("预览局面工厂和真打一致：同样的牌和离开顺序，携带、帐篷、余数、神器都一样", () => {
		// 真打
		let g = step(newGame(4), 11, { p1: "leave" }); // 各 2 余 3；甲 2+3
		g = step(g, "A1", { p2: "leave", p3: "leave" }); // 乙丙同走，神器留路上
		g = step(g, 13);
		g = reveal(g, "fire"); // 丁 2+13，决定中
		// 工厂
		const s = buildScene({ players: 4, path: [11, "A1", 13, "fire"], leftAfter: { p1: 1, p2: 2, p3: 2 } });
		expect(s.phase).toBe("decide");
		for (const id of ["p1", "p2", "p3", "p4"]) {
			expect(tent(s, id)).toBe(tent(g, id));
			expect(carried(s, id)).toBe(carried(g, id));
			expect(player(s, id).artifacts).toEqual(player(g, id).artifacts);
		}
		expect(carried(s, "p4")).toBe(15);
		expect(tent(s, "p1")).toBe(5);
		expect(s.pathGems).toBe(g.pathGems);
		expect(s.pathArtifacts).toEqual([1]);
		expect(s.deckCount).toBe(31 - 4);
	});
});
