import { useEffect, useState, type ReactNode } from "react";
import {
  bustChance,
  cardLabel,
  deckInfo,
  HAZARD_NAMES,
  HAZARD_TYPES,
  legalActions,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyRoomSnapshot,
} from "@incan/game";
import GameRules from "./GameRules.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";
import type { Theme } from "./theme.js";

/**
 * 调试牌桌（引擎阶段放的）：把整个状态摊开显示，每个合法行动一个按钮，方便联调。
 * 正式牌桌由界面阶段重做；props 和 App.tsx 的接法保持不变。
 */
interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly themeToggle: ReactNode;
  readonly theme: Theme;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看（印加宝藏观战不分座位视角，留着和 App 的接法一致）。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  readonly onLeave: () => void;
}

const PHASE_NAMES: Record<GameState["phase"], string> = {
  start: "新一局开始",
  decide: "决定：继续还是离开",
  reveal: "亮出选择",
  skip: "第一张是危险，直接翻下一张",
  roundEnd: "本局结束",
  gameOver: "对局结束",
};

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - Math.max(0, now - anchor.at)) / 1000));
}

/** 事件的中文说明（调试用；正式界面可以参考）。 */
export function describeEvent(event: GameEvent, name: (id: string) => string): string {
  const names = (ids: string[]) => (ids.length ? ids.map(name).join("、") : "没有人");
  switch (event.type) {
    case "RoundStarted":
      return `第 ${event.round} 局开始：牌堆 ${event.deckCount} 张（神器 ${event.deckArtifacts} 件${event.newArtifact ? `，新放进第 ${event.newArtifact} 件` : ""}）`;
    case "CardRevealed":
      if (event.card.kind === "treasure") return `翻出${cardLabel(event.card)}：${event.inTemple} 人各分 ${event.share} 颗，余 ${event.remainder} 颗留在路上`;
      if (event.card.kind === "hazard") return `翻出${cardLabel(event.card)}${event.first ? "（本局第一次，没事）" : "（第二次！）"}`;
      return `翻出${cardLabel(event.card)}，放在路上`;
    case "FirstHazardSkipped":
      return `第一张就是${HAZARD_NAMES[event.hazard]}，不用决定，直接翻下一张`;
    case "Decided":
      return `${name(event.player)} 决定了`;
    case "Undecided":
      return `${name(event.player)} 撤回了决定`;
    case "TimedOut":
      return `${names(event.players)} 超时，按离开处理`;
    case "ChoicesRevealed":
      return `亮出：继续 ${names(event.stay)}；离开 ${names(event.leave)}`;
    case "PlayersLeft":
      return `${names(event.players)} 离开：每人存 ${event.carried} + ${event.share} 颗（路上 ${event.pathGemsBefore} → ${event.pathGemsAfter}）${event.artifacts.length ? `，拿走神器 ${event.artifacts.map((claim) => `第 ${claim.order} 件 ${claim.value} 分`).join("、")}` : ""}`;
    case "Collapse":
      return `塌方！第二张${HAZARD_NAMES[event.hazard]}：${names(event.caught)} 每人丢 ${event.lostGems} 颗；${HAZARD_NAMES[event.hazard]}已移出 ${event.removedNow} 张`;
    case "RoundEnded":
      return `第 ${event.result.round} 局结束（${event.result.reason === "collapse" ? "塌方" : "全员离开"}）：作废余数 ${event.result.pathGemsDiscarded} 颗${event.result.artifactsDiscarded.length ? `、神器 ${event.result.artifactsDiscarded.join("、")}` : ""}`;
    case "GameEnded":
      return `对局结束，胜者：${names(event.result.winners)}`;
  }
}

function commandLabel(command: GameCommand): string {
  if (command.type === "undecide") return "撤回";
  return command.choice === "stay" ? "继续挖（手电筒）" : "离开（回营地）";
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, chat, onCommand, onRematch, onAuto, onDissolve, onWatch, onLeave }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const spectating = !member;
  const selfId = member?.playerId ?? "";
  const isHost = member?.isHost ?? false;
  const autoPlaying = member?.auto === true;
  const finished = game.phase === "gameOver";
  const seconds = useCountdown(room);
  const nameOf = (id: string) => game.players.find((player) => player.id === id)?.name ?? id;
  const memberOf = (id: string) => room.members.find((candidate) => candidate.playerId === id);
  const actions = spectating ? [] : legalActions(game, selfId);
  const info = deckInfo(game);
  const bust = bustChance(game);
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;

  return (
    <div className="ig-debug">
      <header className="topbar ig-debug-top">
        {brand}
        <div className="ig-debug-status">
          <b>第 {game.round} / {game.config.rounds} 局</b>
          <span>{PHASE_NAMES[game.phase]}</span>
          {seconds !== null && !finished && <span className="ig-debug-timer">{seconds} 秒</span>}
          {game.config.noArtifacts && <span>无神器</span>}
        </div>
        <div className="topbar-right">
          <GameRoomMenu room={room} />
          {!spectating && !finished && (
            <button className="quiet-button" type="button" onClick={() => onAuto(!autoPlaying)}>{autoPlaying ? "取消托管" : "托管"}</button>
          )}
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {themeToggle}
          <GameRules />
          {connection}
        </div>
      </header>
      {spectating && <SpectateBar room={room} watchId="" onWatch={onWatch} onLeave={onLeave} showSeats={false} />}
      <div className="ig-debug-note">调试牌桌（引擎阶段）：正式界面由界面阶段做。</div>

      <section className="ig-debug-grid">
        <div className="ig-debug-panel">
          <h3>路径（本局翻出 {game.path.length} 张）</h3>
          <ol className="ig-debug-path">
            {game.path.map((card, index) => {
              const taken = card.kind === "artifact" && !game.pathArtifacts.includes(card.artifact);
              return (
                <li key={index} className={`ig-card ig-card-${card.kind}${taken ? " taken" : ""}`}>
                  {cardLabel(card)}
                  {taken ? "（已被拿走）" : ""}
                </li>
              );
            })}
          </ol>
          <p>路上余数：<b>{game.pathGems}</b> 颗 · 路上神器：<b>{game.pathArtifacts.length ? game.pathArtifacts.join("、") : "无"}</b></p>
          <p>
            牌堆：<b>{game.deckCount}</b> 张（宝物 {info.treasures.length} 张共 {info.treasureGems} 颗，神器 {info.artifacts} 件；
            {HAZARD_TYPES.map((hazard) => `${HAZARD_NAMES[hazard]} ${info.hazards[hazard]}`).join("、")}）
          </p>
          <p>
            永久移出：{HAZARD_TYPES.filter((hazard) => game.removed[hazard] > 0).map((hazard) => `${HAZARD_NAMES[hazard]} ×${game.removed[hazard]}`).join("、") || "无"}
            {" · "}已带出神器 {game.artifactsClaimed} 件（下一件 {game.artifactsClaimed < 3 ? 5 : 10} 分）· 作废神器 {game.artifactsLost.join("、") || "无"}
          </p>
          <p>下一张塌方的概率：<b>{Math.round(bust * 100)}%</b></p>
        </div>

        <div className="ig-debug-panel">
          <h3>你的行动</h3>
          {spectating ? <p>观战中，不能操作。</p> : actions.length === 0 ? <p>{finished ? "对局结束。" : "现在不用你决定。"}</p> : null}
          <div className="ig-debug-actions">
            {actions.map((command, index) => (
              <button key={index} className={command.type === "decide" && command.choice === "leave" ? "quiet-button" : "primary-button"} type="button" disabled={busy} onClick={() => onCommand(command)}>
                {commandLabel(command)}
              </button>
            ))}
          </div>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
          <h3>这一步的事件</h3>
          <ul className="ig-debug-events">
            {game.events.map((event, index) => <li key={index}>{describeEvent(event, nameOf)}</li>)}
          </ul>
        </div>

        <div className="ig-debug-panel ig-debug-wide">
          <h3>玩家</h3>
          <table className="ig-debug-table">
            <thead>
              <tr><th>玩家</th><th>状态</th><th>本局携带</th><th>帐篷</th><th>神器</th><th>决定</th></tr>
            </thead>
            <tbody>
              {game.players.map((player) => {
                const seat = memberOf(player.id);
                const tags = [seat?.bot ? "人机" : "", seat?.auto ? "托管" : "", seat && !seat.connected ? "离线" : "", player.id === selfId ? "你" : ""].filter(Boolean);
                const status = finished ? "" : player.inTemple ? (game.phase === "roundEnd" ? "被困（塌方）" : "神庙里") : `第 ${player.leftAfter} 张后离开`;
                return (
                  <tr key={player.id} className={player.id === selfId ? "me" : ""}>
                    <td>{player.name}{tags.length ? `（${tags.join("、")}）` : ""}</td>
                    <td>{status}</td>
                    <td>{player.carried}</td>
                    <td>{player.tent === null ? "？" : player.tent}</td>
                    <td>{player.artifacts.map((claim) => `#${claim.artifact}（第 ${claim.order} 件 ${claim.value} 分）`).join("、") || "—"}</td>
                    <td>{player.decided ? (player.choice ? (player.choice === "stay" ? "继续" : "离开") : "已决定") : player.inTemple && game.phase === "decide" ? "思考中" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {finished && game.finalResult && (
          <div className="ig-debug-panel ig-debug-wide">
            <h3>结算</h3>
            <ol>
              {game.finalResult.scores.map((line) => (
                <li key={line.player}>
                  第 {line.rank} 名 {nameOf(line.player)}：宝石 {line.gems} + 神器 {line.artifactPoints}（{line.artifacts.length} 件）= <b>{line.total}</b>
                  {game.finalResult!.winners.includes(line.player) ? " 胜" : ""}
                </li>
              ))}
            </ol>
            {room.rematch && !spectating && (
              <div className="ig-debug-actions">
                <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
                <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "已同意" : "再来一局"}</button>
                <button className="quiet-button" type="button" onClick={() => onRematch(false)}>不玩了</button>
              </div>
            )}
          </div>
        )}

        <div className="ig-debug-panel">
          <h3>各局结果</h3>
          <ul>
            {game.history.map((result) => (
              <li key={result.round}>
                第 {result.round} 局：{result.reason === "collapse" ? `${HAZARD_NAMES[result.hazard!]}塌方，被困 ${result.caught.map(nameOf).join("、") || "无人"}（各丢 ${result.lostGems}）` : "全员离开"}，翻了 {result.cards} 张
              </li>
            ))}
          </ul>
          <h3>离开记录</h3>
          <ul>
            {game.departures.map((departure, index) => (
              <li key={index}>
                第 {departure.round} 局第 {departure.after} 张后：{departure.players.map(nameOf).join("、")}
                {departure.artifacts.length ? `（拿走神器 ${departure.artifacts.map((claim) => claim.artifact).join("、")}）` : ""}
              </li>
            ))}
          </ul>
        </div>
        <div className="ig-debug-panel">{chat}</div>
      </section>
      <details className="ig-debug-raw">
        <summary>原始状态（version {game.version}，turn {game.turn}）</summary>
        <pre>{JSON.stringify(game, null, 1)}</pre>
      </details>
    </div>
  );
}

export default GameBoard;
