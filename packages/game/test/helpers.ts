import {
  advance,
  apply,
  createGame,
  stackDeck,
  type Card,
  type Choice,
  type GameState,
} from "../src/index.js";
import { parseCard, type CardSpec } from "../src/cards.js";

export const P3 = [
  { id: "a", name: "甲" },
  { id: "b", name: "乙" },
  { id: "c", name: "丙" },
];
export const P4 = [...P3, { id: "d", name: "丁" }];

/** 开局并把牌堆顶摆成 cards（神器写 "A1" 这种）。 */
export function stacked(players: { id: string; name: string }[], cards: CardSpec[], seed = 7, noArtifacts = false): GameState {
  const game = createGame(players, seed, { noArtifacts });
  return stackDeck(game, cards.map((spec) => parseCard(spec) as Card));
}

/** 自动推进一步。 */
export function step(state: GameState): GameState {
  return advance(state).state;
}

/** 按 choices 让神庙里所有人决定（没写的人继续）。 */
export function decide(state: GameState, choices: Record<string, Choice> = {}): GameState {
  let current = state;
  for (const player of state.players) {
    if (!player.inTemple || player.decided) continue;
    current = apply(current, player.id, { type: "decide", choice: choices[player.id] ?? "stay", turn: current.turn }).state;
  }
  return current;
}

export function player(state: GameState, id: string) {
  const found = state.players.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no player ${id}`);
  return found;
}

/** 深冻结（检查 apply 不改输入）。 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
