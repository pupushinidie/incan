/**
 * 规则核对（背靠背）：随机对局里检查规则书和勘误的不变量（用验收自己的计算，不用引擎的自检）。
 * 3–8 人各若干局，选择随机，偶尔改选、撤回、超时；一部分开「无神器」。
 */
import { describe, expect, it } from "vitest";
import {
	advance,
	apply,
	HAZARD_TYPES,
	pendingDeciders,
	redactGameForViewer,
	timeoutTurn,
	type GameState,
} from "../../src/index.js";
import { expectedArtifactValue, lcg, newGame, sum } from "./helpers.js";

const GAMES_PER_COUNT = 120;
const MAX_STEPS = 2000;

function runGame(n: number, seed: number, noArtifacts: boolean, errors: string[]): GameState {
	const rnd = lcg(seed * 7919 + n);
	const err = (msg: string) => errors.push(`[${n}人 seed=${seed}${noArtifacts ? " 无神器" : ""}] ${msg}`);
	let g = newGame(n, seed, { noArtifacts });
	const stayBias = 0.55 + rnd() * 0.4;
	let roundStartDeck = -1;
	let roundStartTents: number[] = [];
	let lastRound = 0;
	let lastVersion = g.version - 1;

	for (let steps = 0; steps < MAX_STEPS; steps++) {
		if (g.version <= lastVersion) err(`version 没前进：${g.version}`);
		lastVersion = g.version;

		// —— 每一步都成立的 ——
		for (const t of HAZARD_TYPES) if (g.removed[t] < 0 || g.removed[t] > 2) err(`removed.${t}=${g.removed[t]}`);
		const collapses = g.history.filter((h) => h.reason === "collapse").length;
		const removedNow = sum(HAZARD_TYPES.map((t) => g.removed[t]));
		if (removedNow !== collapses) err(`移出的危险 ${removedNow} ≠ 塌方次数 ${collapses}`);
		const claimed = g.players.flatMap((p) => p.artifacts);
		if (claimed.length !== g.artifactsClaimed) err(`带出神器件数对不上 ${claimed.length} vs ${g.artifactsClaimed}`);
		const orders = claimed.map((a) => a.order).sort((a, b) => a - b);
		if (orders.join() !== Array.from({ length: orders.length }, (_, i) => i + 1).join()) err(`带出序号不连续 ${orders}`);
		for (const a of claimed) if (a.value !== expectedArtifactValue(a.order)) err(`第 ${a.order} 件值 ${a.value}`);
		if (noArtifacts && (claimed.length > 0 || g.deckArtifacts > 0 || g.path.some((c) => c.kind === "artifact")))
			err("无神器却出现了神器");
		if (g.pathGems < 0) err(`pathGems=${g.pathGems}`);
		if (g.deck.length !== g.deckCount) err(`deck.length ${g.deck.length} ≠ deckCount ${g.deckCount}`);
		if (g.phase !== "roundEnd" && g.phase !== "gameOver") {
			const inT = g.players.filter((p) => p.inTemple).map((p) => p.carried);
			if (new Set(inT).size > 1) err(`神庙里的人携带不相等 ${inT}（S9）`);
		}
		// 本局路上：危险最多出现两次，第二次一定是最后一张、本局塌方
		const hz = new Map<string, number>();
		g.path.forEach((c, i) => {
			if (c.kind !== "hazard") return;
			const k = (hz.get(c.hazard) ?? 0) + 1;
			hz.set(c.hazard, k);
			if (k >= 2 && i !== g.path.length - 1) err(`同种危险第二次出现后还在翻牌`);
			if (k > 2) err(`同种危险出现 ${k} 次`);
		});

		// 隐藏信息：随便挑一个视角
		const viewer = g.players[Math.floor(rnd() * n)]!.id;
		const r = redactGameForViewer(g, viewer);
		if (r.deck.length !== 0 || r.seed !== undefined || r.rngState !== undefined || r.log !== undefined) err("脱敏后还有牌堆或种子");
		for (const p of r.players) {
			if (p.id !== viewer && g.phase !== "gameOver" && p.tent !== null) err(`${viewer} 看到了 ${p.id} 的帐篷`);
			if (p.id !== viewer && g.phase === "decide" && p.choice !== null) err(`${viewer} 看到了 ${p.id} 决定中的选择`);
		}

		// —— 新一局开始 ——
		if (g.round !== lastRound) {
			lastRound = g.round;
			if (g.phase !== "start") err(`新一局不在 start：${g.phase}`);
			if (g.path.length || g.pathGems || g.pathArtifacts.length) err("新一局路径没清空");
			const expectArtifacts = noArtifacts ? 0 : g.round - g.artifactsClaimed - g.artifactsLost.length;
			if (g.deckArtifacts !== expectArtifacts) err(`第 ${g.round} 局牌堆神器 ${g.deckArtifacts}，应为 ${expectArtifacts}（E1）`);
			const expectDeck = 15 + sum(HAZARD_TYPES.map((t) => 3 - g.removed[t])) + g.deckArtifacts;
			if (g.deckCount !== expectDeck) err(`第 ${g.round} 局牌堆 ${g.deckCount}，应为 ${expectDeck}`);
			roundStartDeck = g.deckCount;
			roundStartTents = g.players.map((p) => p.tent ?? 0);
			if (g.players.some((p) => !p.inTemple || p.carried !== 0)) err("新一局有人不在神庙或携带不为 0");
		}
		if (g.phase !== "gameOver" && g.deckCount + g.path.length !== roundStartDeck) err("牌堆 + 路径 ≠ 局初牌堆");

		// —— 局末：宝石守恒 ——
		if (g.phase === "roundEnd") {
			const res = g.history.at(-1)!;
			if (res.round !== g.round) err(`局末 history 的局数不对`);
			const pathGemsTotal = sum(g.path.map((c) => (c.kind === "treasure" ? c.gems : 0)));
			const gained = sum(g.players.map((p, i) => (p.tent ?? 0) - roundStartTents[i]!));
			const lost = res.caught.length * res.lostGems;
			if (pathGemsTotal !== gained + lost + res.pathGemsDiscarded)
				err(`第 ${g.round} 局宝石不守恒：路上 ${pathGemsTotal} ≠ 存入 ${gained} + 丢 ${lost} + 作废 ${res.pathGemsDiscarded}`);
			if (res.reason === "collapse") {
				const last = g.path.at(-1);
				if (!last || last.kind !== "hazard" || last.hazard !== res.hazard) err("塌方但最后一张不是那种危险");
			} else if (g.players.some((p) => p.inTemple)) err("allLeft 但还有人在神庙里");
		}

		// —— 终局 ——
		if (g.phase === "gameOver") {
			if (g.round !== 5 || g.history.length !== 5) err(`终局在第 ${g.round} 局，history ${g.history.length}`);
			const fr = g.finalResult;
			if (!fr) {
				err("终局没有 finalResult");
				break;
			}
			const totals = new Map(
				g.players.map((p) => [p.id, (p.tent ?? 0) + sum(p.artifacts.map((a) => expectedArtifactValue(a.order)))]),
			);
			for (const s of fr.scores) {
				if (s.total !== totals.get(s.player)) err(`${s.player} 总分 ${s.total} ≠ ${totals.get(s.player)}`);
				if (s.gems + s.artifactPoints !== s.total) err("总分 ≠ 宝石 + 神器分");
			}
			const best = Math.max(...totals.values());
			const top = g.players.filter((p) => totals.get(p.id) === best);
			const most = Math.max(...top.map((p) => p.artifacts.length));
			const winners = top.filter((p) => p.artifacts.length === most).map((p) => p.id).sort();
			if ([...fr.winners].sort().join() !== winners.join()) err(`获胜者 ${fr.winners} 应为 ${winners}`);
			return g;
		}

		// —— 走一步 ——
		if (g.phase === "decide") {
			const pending = pendingDeciders(g);
			if (pending.length === 0) err("decide 阶段没人可决定（卡死）");
			if (rnd() < 0.08) {
				g = timeoutTurn(g);
				continue;
			}
			const id = pending[Math.floor(rnd() * pending.length)]!;
			const choice = rnd() < stayBias ? "stay" : "leave";
			const before = g;
			try {
				g = apply(g, id, { type: "decide", choice, turn: g.turn }).state;
				if (g.phase === "decide" && rnd() < 0.1) {
					g = apply(g, id, { type: "undecide", turn: g.turn }).state;
				}
			} catch (e) {
				err(`合法的决定被拒绝：${(e as Error).message}`);
				g = timeoutTurn(before);
			}
		} else {
			try {
				g = advance(g).state;
			} catch (e) {
				err(`${g.phase} 阶段 advance 报错：${(e as Error).message}`);
				break;
			}
		}
	}
	err(`${MAX_STEPS} 步内没打完`);
	return g;
}

describe("规则核对 · 随机对局不变量", () => {
	for (let n = 3; n <= 8; n++) {
		it(`${n} 人 ${GAMES_PER_COUNT} 局（含无神器、超时、改选）都守规则并打完 5 局`, () => {
			const errors: string[] = [];
			for (let i = 0; i < GAMES_PER_COUNT; i++) runGame(n, 1000 + i, i % 5 === 4, errors);
			expect(errors.slice(0, 20)).toEqual([]);
		});
	}
});
