/**
 * 印加宝藏和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botAdvice, type GameState } from "@incan/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "incan";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个按钮（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

/**
 * 「提示」：让人机从你的位置算一步（botAdvice 的提示模式：固定性格、不加扰动，只看你能看到的信息），配一句原因。
 * game 就是界面拿到的局面（已经按你的视角脱敏）。
 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase !== "decide") return { say: "等下一张牌翻出来再问我。", anchor: null };
  const me = game.players.find((player) => player.id === playerId);
  if (!me?.inTemple) return { say: "你这局已经回营地了，看他们挖吧。", anchor: null };
  const advice = botAdvice(game, playerId, { hint: true });
  if (!advice) return { say: "现在不用选。", anchor: null };
  return advice.choice === "stay"
    ? { say: "我会选「继续挖」。", note: advice.reason, anchor: "btn-stay" }
    : { say: "我会选「回营地」。", note: advice.reason, anchor: "btn-leave" };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "first-skip": { title: "第一张就是危险", text: "这时谁走都拿不到东西，所以不用选，直接翻下一张；这张危险算这局出现过一次。" },
  "hazard-first": { title: "危险第一次出现", text: "没事。同一种危险这局第二次出现才塌方，情况条上的「下一张塌方」就是它的机会。" },
  collapse: { title: "塌方了", text: "还在神庙里的人这局手上的宝石全丢，帐篷里的不受影响；这张危险永久移出，之后几局少一张。" },
  artifact: { title: "神器出现了", text: "只有一个人单独回营地时才能带走；两人以上一起走谁都拿不到。整局前 3 件各 5 分，第 4、5 件各 10 分。" },
  "artifact-shared": { title: "一起走拿不到神器", text: "两人以上同一张牌回营地，神器留在路上；这局结束时还没人拿就作废。" },
  remainder: { title: "余数留在路上", text: "宝石除不尽的部分留在路上，之后由回营地的人平分；一局结束时没人拿的作废。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  const me = game.players.find((player) => player.id === selfId);
  for (const event of game.events) {
    if (event.type === "Collapse") ids.push("collapse");
    if (event.type === "FirstHazardSkipped") ids.push("first-skip");
    if (event.type === "PlayersLeft" && event.players.length > 1 && game.pathArtifacts.length > 0) ids.push("artifact-shared");
    if (event.type === "CardRevealed" && me?.inTemple) {
      if (event.card.kind === "artifact") ids.push("artifact");
      if (event.card.kind === "hazard" && event.first && game.phase === "decide") ids.push("hazard-first");
      if (event.card.kind === "treasure" && event.remainder > 0) ids.push("remainder");
    }
  }
  return ids;
}
