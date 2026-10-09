import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/**
 * 人机占位（引擎阶段放的，人机阶段会换成正式策略）：
 * 轮到它决定时（在神庙里、这一轮还没决定）从「继续 / 离开」里随机挑一个；不用它决定时返回 null。
 * 只吃 redactGameForViewer 之后的状态。随机数用 Math.random（人机不进规则引擎的种子）。
 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  const me = state.players.find((player) => player.id === playerId);
  if (state.phase !== "decide" || !me?.inTemple || me.decided) return null;
  const options = legalActions(state, playerId).filter((command) => command.type === "decide");
  return options[Math.floor(Math.random() * options.length)] ?? null;
}
