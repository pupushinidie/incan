import { HAZARD_NAMES, type GameEvent, type GameState } from "@incan/game";

/** 神器的名字（spec 2.1：编号 = 第几局放进牌堆的那件）。 */
export const ARTIFACT_NAMES: Record<number, string> = { 1: "金面具", 2: "金羊驼", 3: "日轮", 4: "祭刀", 5: "神像" };
export const artifactName = (id: number) => ARTIFACT_NAMES[id] ?? `神器 ${id}`;

/** 下一件被带出的神器值几分（整局第 1–3 件 5 分，第 4–5 件 10 分）。 */
export const artifactValueAt = (order: number) => (order <= 3 ? 5 : 10);

const join = (names: string[]) => (names.length ? names.join("、") : "没有人");

/** 动作记录里的一行（玩家看得懂的话）。不含藏起来的信息：别人带回几颗不写。 */
export function describeEvent(event: GameEvent, game: GameState, name: (id: string) => string, selfId: string): string | null {
  switch (event.type) {
    case "RoundStarted":
      return `第 ${event.round} 局开始：牌堆 ${event.deckCount} 张${event.newArtifact ? `，放进第 ${event.newArtifact} 件神器${event.deckArtifacts > 1 ? `（牌堆里共 ${event.deckArtifacts} 件）` : ""}` : ""}`;
    case "CardRevealed": {
      const card = event.card;
      if (card.kind === "treasure") {
        return `翻出宝物 ${card.gems}：${event.inTemple} 人每人 ${event.share} 颗${event.remainder ? `，余 ${event.remainder} 颗留在路上` : ""}`;
      }
      if (card.kind === "hazard") return `翻出${HAZARD_NAMES[card.hazard]}${event.first ? "：这局第一次出现，没事" : ""}`;
      return `翻出神器「${artifactName(card.artifact)}」，放在路上`;
    }
    case "FirstHazardSkipped":
      return `第一张就是${HAZARD_NAMES[event.hazard]}，不用决定，直接翻下一张`;
    case "TimedOut":
      return `${join(event.players.map(name))} 超时，按回营地处理`;
    case "ChoicesRevealed":
      return `亮出：${event.leave.length ? `${join(event.leave.map(name))} 回营地` : "没人回营地"}${event.stay.length ? `；${join(event.stay.map(name))} 继续挖` : ""}`;
    case "PlayersLeft": {
      const mine = event.players.includes(selfId);
      const solo = event.players.length === 1;
      const parts = [
        `${join(event.players.map(name))} 回到营地`,
        event.pathGemsBefore > 0 ? `路上 ${event.pathGemsBefore} 颗${event.players.length > 1 ? `每人分 ${event.share}` : "全拿"}${event.pathGemsAfter ? `，剩 ${event.pathGemsAfter}` : ""}` : "",
        mine ? `你存进帐篷 ${event.carried + event.share} 颗` : "",
        solo && event.artifacts.length ? `拿走神器 ${event.artifacts.map((claim) => `「${artifactName(claim.artifact)}」${claim.value} 分`).join("、")}` : "",
        !solo && game.pathArtifacts.length ? "一起走，神器谁也拿不到" : "",
      ];
      return parts.filter(Boolean).join("，");
    }
    case "Collapse":
      return `塌方！第二张${HAZARD_NAMES[event.hazard]}：${event.caught.length ? `${join(event.caught.map(name))} 这局的 ${event.lostGems} 颗全丢了` : "里面已经没人了"}；${HAZARD_NAMES[event.hazard]}永久少一张`;
    case "RoundEnded": {
      const result = event.result;
      const lost = [
        result.pathGemsDiscarded ? `路上 ${result.pathGemsDiscarded} 颗作废` : "",
        result.artifactsDiscarded.length ? `神器 ${result.artifactsDiscarded.map((id) => `「${artifactName(id)}」`).join("")}作废` : "",
      ].filter(Boolean);
      return `第 ${result.round} 局结束（${result.reason === "collapse" ? "塌方" : "大家都回营地了"}）${lost.length ? `：${lost.join("，")}` : ""}`;
    }
    case "GameEnded":
      return `探险结束，${event.result.winners.length > 1 ? "并列第一" : "第一名"}：${join(event.result.winners.map(name))}`;
    default:
      return null;
  }
}
