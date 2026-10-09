/**
 * 规则核对（背靠背）用的小工具。只用引擎的对外接口（index.ts 导出），不依赖引擎自己的测试工具。
 * 规则出处：~/Desktop/游戏规则/印加宝藏.md、印加宝藏-补充.md（勘误 E1–E11、用例 S1–S9）、开工拍板 kickoff.json。
 */
import {
	advance,
	apply,
	createGame,
	parseCard,
	stackDeck,
	type CardSpec,
	type Choice,
	type GameEvent,
	type GameOptions,
	type GameState,
	type Player,
} from "../../src/index.js";

/** 座位 id 是 p1..pN。 */
export function seats(n: number): { id: string; name: string }[] {
	return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` }));
}

export function newGame(n: number, seed = 7, options?: Partial<GameOptions>): GameState {
	return createGame(seats(n), seed, options);
}

export function player(g: GameState, id: string): Player {
	const p = g.players.find((x) => x.id === id);
	if (!p) throw new Error(`没有座位 ${id}`);
	return p;
}

/** 服务端状态里的帐篷宝石（完整状态里一定是数字）。 */
export function tent(g: GameState, id: string): number {
	const t = player(g, id).tent;
	if (t === null) throw new Error(`${id} 的帐篷是 null（不是服务端完整状态？）`);
	return t;
}

export function carried(g: GameState, id: string): number {
	return player(g, id).carried;
}

/** 在自动阶段翻一张：给了牌就先把它放到牌堆顶。 */
export function reveal(g: GameState, card?: CardSpec): GameState {
	let s = g;
	if (card !== undefined) s = stackDeck(s, [parseCard(card)]);
	return advance(s).state;
}

/**
 * 神庙里还没决定的人全部决定（用 apply，带上 turn）：choices 里写了的按写的，其余按 fallback。
 * 返回最后一步的状态（最后一个人决定后应进入 reveal）。
 */
export function decide(g: GameState, choices: Record<string, Choice> = {}, fallback: Choice = "stay"): GameState {
	let s = g;
	const ids = s.players.filter((p) => p.inTemple && !p.decided).map((p) => p.id);
	for (const id of ids) {
		s = apply(s, id, { type: "decide", choice: choices[id] ?? fallback, turn: s.turn }).state;
	}
	return s;
}

/** 翻一张，然后（如果进入决定）所有人按 choices 决定。 */
export function step(g: GameState, card: CardSpec, choices: Record<string, Choice> = {}, fallback: Choice = "stay"): GameState {
	const s = reveal(g, card);
	if (s.phase !== "decide") return s;
	return decide(s, choices, fallback);
}

/** 一路 advance，直到阶段变成 target（最多 20 步）。 */
export function advanceUntil(g: GameState, target: GameState["phase"]): GameState {
	let s = g;
	for (let i = 0; i < 20 && s.phase !== target; i++) s = advance(s).state;
	if (s.phase !== target) throw new Error(`推进不到 ${target}，停在 ${s.phase}`);
	return s;
}

/** 收集一次推进产生的事件。 */
export function eventsOf<T extends GameEvent["type"]>(g: GameState, type: T): Extract<GameEvent, { type: T }>[] {
	return g.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

export function sum(xs: readonly number[]): number {
	return xs.reduce((a, b) => a + b, 0);
}

/** 规则书 2.3：第 n 件带出的神器分值（验收自己的实现，不用引擎的）。 */
export function expectedArtifactValue(order: number): number {
	return order <= 3 ? 5 : 10;
}

/** 可复现的小随机数（只给随机对局挑选择用）。 */
export function lcg(seed: number): () => number {
	let x = seed >>> 0 || 1;
	return () => {
		x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
		return x / 2 ** 32;
	};
}

export function deepFreeze<T>(o: T): T {
	if (o && typeof o === "object" && !Object.isFrozen(o)) {
		Object.freeze(o);
		for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
	}
	return o;
}
