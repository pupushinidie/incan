/**
 * 印加宝藏的牌桌。
 *
 * 一屏放下：顶栏一行（局数、一句状态、倒计时、按钮）；下面左边是牌桌（神庙场景当背景），右边（够宽时）是状态和「记录 / 各局 / 聊天」，
 * 不够宽时收进抽屉。牌桌从上到下：情况条（危险、牌堆、余数、神器、塌方概率）→ 神庙路径 → 营地（每人一张帐篷卡）→ 操作条（继续挖 / 回营地）。
 * 手机上从上往下排，第一屏有状态、路径、两个大按钮和自己的数字，营地和记录往下放。
 *
 * 动画只看 game.version 变没变（聊天也会推快照）；临时特效的计时器放在持久的表里，只在卸载时清掉。
 * 入场动画只用位移和缩放，不动 left/top，不给 <img> 做透明度动画。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  bustChance,
  HAZARD_NAMES,
  legalActions,
  type Choice,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type Player,
} from "@incan/game";
import { art, coverSize, seatColor, SEAT_HEX } from "./art.js";
import GameRules from "./GameRules.js";
import { useLayout, type Layout } from "./layout.js";
import { GameRoomMenu } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { Coach, TipToast } from "./tutorial/Coach.js";
import { useFirstTimeTips } from "./tutorial/tips.js";
import { detectTips, GAME_ID, hintFor, TIPS, type Hint } from "./tutorialGame.js";
import { bustTone, Camp, Icon, InfoBar, PathView, percent, Px, type PathFx, type TentFx } from "./Table.js";
import type { Theme } from "./theme.js";
import { artifactName, describeEvent } from "./words.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly theme: Theme;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看（印加宝藏观战不分座位视角，留着和 App 的接法一致）。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
  /** 操作条上留给教程的位置（「提示」按钮之类）。 */
  readonly actionExtra?: ReactNode;
  /** 自己在 room.members 里的 id（默认 socket.id；教程里传固定值）。 */
  readonly selfMemberId?: string;
  /** online：真实对局；tutorial：剧本进行中（不出提示和小贴士）；practice：教程后的练习局（随时能看提示）。 */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 结算框里替代「再来一局」的按钮（练习局放「结束教程」「再练一局」）。 */
  readonly finalActions?: ReactNode;
}

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

/** 持久的计时器表：临时特效到点自己消失；版本变化不清，卸载时才清。 */
function useTimers() {
  const timers = useRef(new Set<number>());
  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
  }, []);
  return useCallback((fn: () => void, ms: number) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  }, []);
}

interface Flight {
  id: number;
  kind: "gem" | "artifact";
  x: number;
  y: number;
  dx: number;
  dy: number;
  delay: number;
  s: number;
}
interface Spark {
  id: number;
  x: number;
  y: number;
  delay: number;
  s: number;
}
interface Toast {
  key: number;
  text: string;
  tone: "info" | "danger" | "gold" | "reveal";
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function GameBoard({
  room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand, onRematch, onAuto, onDissolve, onLeave, actionExtra,
  selfMemberId, mode = "online", finalActions,
}: GameBoardProps) {
  const game = room.game!;
  const memberId = selfMemberId ?? socket.id ?? "";
  const member = room.members.find((candidate) => candidate.id === memberId);
  const spectating = !member;
  const selfId = member?.playerId ?? "";
  const isHost = member?.isHost ?? false;
  const autoPlaying = member?.auto === true;
  const me = game.players.find((player) => player.id === selfId) ?? null;
  const finished = game.phase === "gameOver";
  const secondsLeft = useCountdown(room);
  const memberOf = useCallback((playerId: string) => room.members.find((candidate) => candidate.playerId === playerId), [room.members]);
  const nameOf = useCallback(
    (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?"),
    [game.players, selfId],
  );
  const colorOf = (playerId: string) => seatColor(game.players.findIndex((player) => player.id === playerId));
  const explorersIn = game.phase === "roundEnd" || finished ? [] : game.players.filter((player) => player.inTemple);
  const [mainRef, layout, mainBox] = useLayout(game.players.length, game.path.length);
  const pending = game.phase === "decide" ? game.players.filter((player) => player.inTemple && !player.decided) : [];
  const canDecide = !spectating && !finished && game.phase === "decide" && !!me?.inTemple && !autoPlaying;
  const myTurn = canDecide && !me!.decided;
  const amLast = myTurn && pending.length === 1;
  const actions = canDecide ? legalActions(game, selfId) : [];
  const chance = bustChance(game);

  // 「提示」：练习局随时能用；真实对局里只有自己和人机时能用（有别的真人就不显示，免得不公平）
  const botsOnly = room.members.length > 1 && room.members.every((candidate) => candidate.playerId === selfId || candidate.bot === true);
  const canHint = myTurn && (mode === "practice" || (mode === "online" && botsOnly));
  const [hint, setHint] = useState<{ version: number; hint: Hint } | null>(null);
  const shownHint = hint && hint.version === game.version && canHint ? hint.hint : null;
  const toggleHint = () => setHint((current) => (current && current.version === game.version ? null : { version: game.version, hint: hintFor(game, selfId) }));
  useEffect(() => {
    if (!canHint) return;
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key.toLowerCase() === "h") toggleHint();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [canHint, game.version]);

  // 真实对局里第一次遇到某条规则（首张危险、塌方、神器……）时弹一句小贴士
  const tips = useFirstTimeTips(GAME_ID, game.version, () => detectTips(game, selfId), TIPS, mode === "online" && !spectating);
  // 「对局已开始」这类提示只留到第一步动作
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";

  // 页面在后台时，轮到自己决定就在标题上提醒
  useEffect(() => {
    const base = "印加宝藏 · 在线对战";
    const update = () => { document.title = myTurn && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [myTurn]);

  // ---------- 动作记录 ----------
  const [log, setLog] = useState<{ key: string; text: string }[]>(() => initialLog(game, nameOf, selfId));
  const loggedVersion = useRef(game.version);
  useEffect(() => {
    if (game.version === loggedVersion.current) return;
    loggedVersion.current = game.version;
    const lines = game.events
      .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, game, nameOf, selfId) }))
      .filter((line): line is { key: string; text: string } => line.text !== null);
    if (lines.length) setLog((previous) => [...lines.reverse(), ...previous].slice(0, 80));
  }, [game.version]);

  // 自己这局开始时的帐篷（局末小结写「你这局带回几颗」用；中途刷新后不知道就不写数字）
  const roundStartTent = useRef(new Map<number, number>());
  if (me && me.tent !== null && game.phase === "start" && !roundStartTent.current.has(game.round)) {
    roundStartTent.current.set(game.round, me.tent);
  }

  // ---------- 特效 ----------
  const later = useTimers();
  const fxRef = useRef<HTMLDivElement | null>(null);
  const cardEls = useRef(new Map<number, HTMLElement>());
  const tentEls = useRef(new Map<string, HTMLElement>());
  const slotEl = useRef<HTMLElement | null>(null);
  const gemsEl = useRef<HTMLElement | null>(null);
  const cardRef = useCallback((index: number) => (el: HTMLElement | null) => {
    if (el) cardEls.current.set(index, el);
    else cardEls.current.delete(index);
  }, []);
  const tentRef = useCallback((playerId: string) => (el: HTMLElement | null) => {
    if (el) tentEls.current.set(playerId, el);
    else tentEls.current.delete(playerId);
  }, []);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [floats, setFloats] = useState<TentFx["floats"]>(new Map());
  const [glow, setGlow] = useState<TentFx["glow"]>(new Map());
  const [wobble, setWobble] = useState<Set<number>>(new Set());
  const [shaking, setShaking] = useState(false);
  const takenBy = useMemo(() => {
    const map = new Map<number, string>();
    for (const departure of game.departures) {
      if (departure.round !== game.round) continue;
      for (const claim of departure.artifacts) {
        const index = game.path.findIndex((card) => card.kind === "artifact" && card.artifact === claim.artifact);
        if (index >= 0) map.set(index, nameOf(departure.players[0]!));
      }
    }
    return map;
  }, [game.version, nameOf]);
  const seq = useRef(0);
  const fxVersion = useRef(game.version);

  useLayoutEffect(() => {
    if (game.version === fxVersion.current) return;
    fxVersion.current = game.version;
    const layer = fxRef.current?.getBoundingClientRect();
    if (!layer) return;
    const quiet = reducedMotion();
    const center = (el: HTMLElement | null | undefined) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return null;
      return { x: rect.left + rect.width / 2 - layer.left, y: rect.top + rect.height / 2 - layer.top };
    };
    const newFlights: Flight[] = [];
    const newSparks: Spark[] = [];
    const newFloats = new Map<string, { text: string; key: number; tone?: string }>();
    const newGlow = new Map<string, string>();
    const gs = layout.mobile ? 1 : 2;
    const fly = (kind: Flight["kind"], from: { x: number; y: number } | null, to: { x: number; y: number } | null, delay: number) => {
      if (!from || !to || quiet) return;
      seq.current += 1;
      newFlights.push({ id: seq.current, kind, x: from.x, y: from.y, dx: to.x - from.x, dy: to.y - from.y, delay, s: gs });
    };
    const spark = (at: { x: number; y: number } | null, delay: number) => {
      if (!at || quiet) return;
      seq.current += 1;
      newSparks.push({ id: seq.current, x: at.x, y: at.y, delay, s: gs });
    };
    let nextToast: Toast | null = null;
    for (const event of game.events) {
      if (event.type === "RoundStarted") {
        nextToast = { key: game.version, tone: "info", text: `第 ${event.round} 局开始${event.newArtifact ? ` · 放进神器「${artifactName(event.newArtifact)}」` : ""}` };
      } else if (event.type === "CardRevealed") {
        const from = center(cardEls.current.get(event.index));
        if (event.card.kind === "treasure") {
          spark(from, 0);
          const takers = game.players.filter((player) => player.inTemple);
          if (event.share > 0) {
            takers.forEach((player, order) => {
              const to = center(tentEls.current.get(player.id));
              for (let gem = 0; gem < Math.min(event.share, 3); gem += 1) fly("gem", from, to, 250 + order * 40 + gem * 110);
              seq.current += 1;
              newFloats.set(player.id, { text: `+${event.share}`, key: seq.current });
            });
          }
          if (event.remainder > 0) {
            const to = center(gemsEl.current);
            for (let gem = 0; gem < Math.min(event.remainder, 3); gem += 1) fly("gem", from, to, 300 + gem * 120);
          }
        }
      } else if (event.type === "FirstHazardSkipped") {
        nextToast = { key: game.version, tone: "info", text: `第一张就是${HAZARD_NAMES[event.hazard]}：不用决定，直接翻下一张` };
      } else if (event.type === "ChoicesRevealed") {
        nextToast = {
          key: game.version,
          tone: "reveal",
          text: event.leave.length === 0 ? "亮拳！大家都继续挖" : event.stay.length === 0 ? "亮拳！大家都回营地" : `亮拳！${event.leave.map(nameOf).join("、")} 回营地`,
        };
      } else if (event.type === "PlayersLeft") {
        const pathFrom = center(gemsEl.current) ?? center(slotEl.current);
        event.players.forEach((id, order) => {
          const to = center(tentEls.current.get(id));
          const gems = event.carried + event.share;
          for (let gem = 0; gem < Math.min(gems, 4); gem += 1) fly("gem", event.share > 0 && gem === 0 ? pathFrom : center(slotEl.current) ?? pathFrom, to, 200 + order * 60 + gem * 130);
          spark(to, 900 + order * 60);
          seq.current += 1;
          if (id === selfId) newFloats.set(id, { text: `+${gems} 进帐篷`, key: seq.current, tone: "gold" });
          else newFloats.set(id, { text: "回营地", key: seq.current, tone: "home" });
          newGlow.set(id, "home-glow");
        });
        if (event.artifacts.length > 0) {
          const claimer = event.players[0]!;
          const to = center(tentEls.current.get(claimer));
          for (const claim of event.artifacts) {
            const index = game.path.findIndex((card) => card.kind === "artifact" && card.artifact === claim.artifact);
            fly("artifact", center(cardEls.current.get(index)), to, 400);
          }
          spark(to, 1200);
          newGlow.set(claimer, "claim-glow");
          seq.current += 1;
          newFloats.set(claimer, { text: `神器 +${event.artifacts.reduce((sum, claim) => sum + claim.value, 0)} 分`, key: seq.current, tone: "gold" });
          nextToast = { key: game.version, tone: "gold", text: `${nameOf(claimer)}单独回营地，拿走神器 ${event.artifacts.map((claim) => `「${artifactName(claim.artifact)}」${claim.value} 分`).join(" ")}` };
        } else if (event.players.length > 1 && game.pathArtifacts.length > 0) {
          const indices = game.path.flatMap((card, index) => (card.kind === "artifact" && game.pathArtifacts.includes(card.artifact) ? [index] : []));
          setWobble(new Set(indices));
          later(() => setWobble(new Set()), 1200);
          nextToast = { key: game.version, tone: "info", text: "一起回营地的人拿不到神器，神器留在路上" };
        }
      } else if (event.type === "Collapse") {
        setShaking(true);
        later(() => setShaking(false), 1400);
        for (const id of event.caught) {
          seq.current += 1;
          newFloats.set(id, { text: `−${event.lostGems}`, key: seq.current, tone: "bad" });
        }
        nextToast = { key: game.version, tone: "danger", text: `塌方！第二张${HAZARD_NAMES[event.hazard]}${event.caught.length ? `，${event.caught.map(nameOf).join("、")} 这局白干` : ""}` };
      } else if (event.type === "TimedOut" && event.players.includes(selfId)) {
        nextToast = { key: game.version, tone: "info", text: "你超时了，按「回营地」处理" };
      }
    }
    if (newFlights.length) {
      setFlights((previous) => [...previous, ...newFlights]);
      const ids = new Set(newFlights.map((flight) => flight.id));
      later(() => setFlights((previous) => previous.filter((flight) => !ids.has(flight.id))), Math.max(...newFlights.map((flight) => flight.delay)) + 900);
    }
    if (newSparks.length) {
      setSparks((previous) => [...previous, ...newSparks]);
      const ids = new Set(newSparks.map((item) => item.id));
      later(() => setSparks((previous) => previous.filter((item) => !ids.has(item.id))), Math.max(...newSparks.map((item) => item.delay)) + 600);
    }
    if (newFloats.size) {
      setFloats((previous) => new Map([...previous, ...newFloats]));
      const keys = new Map([...newFloats].map(([id, value]) => [id, value.key]));
      later(() => setFloats((previous) => new Map([...previous].filter(([id, value]) => keys.get(id) !== value.key))), 1800);
    }
    if (newGlow.size) {
      setGlow((previous) => new Map([...previous, ...newGlow]));
      later(() => setGlow((previous) => new Map([...previous].filter(([id]) => !newGlow.has(id)))), 2400);
    }
    if (nextToast) {
      const shown = nextToast;
      setToast(shown);
      later(() => setToast((current) => (current?.key === shown.key ? null : current)), shown.tone === "reveal" ? 1600 : 2600);
    }
  }, [game.version]);

  const freshEvent = game.events.find((event) => event.type === "CardRevealed");
  const pathFx: PathFx = {
    fresh: freshEvent?.type === "CardRevealed" ? freshEvent.index : null,
    freshLabel:
      freshEvent?.type === "CardRevealed" && freshEvent.card.kind === "treasure"
        ? `每人 +${freshEvent.share}${freshEvent.remainder ? ` · 余 ${freshEvent.remainder}` : ""}`
        : freshEvent?.type === "CardRevealed" && freshEvent.card.kind === "hazard" && freshEvent.first
          ? "第一次，没事"
          : null,
    wobble,
    collapse: shaking,
    takenBy,
  };

  // ---------- 决定 ----------
  const decide = (choice: Choice) => {
    if (!canDecide || busy) return;
    if (me!.decided && me!.choice === choice) return;
    onCommand({ type: "decide", choice, turn: game.turn });
  };
  const undecide = () => {
    if (!canDecide || busy || !me!.decided) return;
    onCommand({ type: "undecide", turn: game.turn });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "1" || event.key === "ArrowLeft") decide("stay");
      else if (event.key === "2" || event.key === "ArrowRight") decide("leave");
      else if (event.key === "Escape" || event.key === "Backspace") undecide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- 状态文字 ----------
  const last = game.history.at(-1);
  const roundOver = game.phase === "roundEnd" && last?.round === game.round;
  let headline = "";
  let detail = "";
  if (finished) {
    headline = "探险结束";
    detail = "看结算，房间里的人同意就再来一局。";
  } else if (game.phase === "start") {
    headline = `第 ${game.round} 局开始`;
    detail = "大家一起进神庙，马上翻第一张。";
  } else if (game.phase === "skip") {
    headline = "第一张是危险";
    detail = "这时谁走都拿不到东西，不用决定，直接翻下一张。";
  } else if (game.phase === "reveal") {
    headline = "亮拳！";
    const left = game.players.filter((player) => player.decided && player.choice === "leave" && !player.inTemple);
    detail = left.length ? `${left.map((player) => nameOf(player.id)).join("、")} 回营地，宝石存进帐篷。` : "大家都继续挖，翻下一张。";
  } else if (roundOver) {
    headline = last!.reason === "collapse" ? "塌方！" : "大家都回营地了";
    detail = game.round >= game.config.rounds ? "马上结算。" : `第 ${game.round + 1} 局马上开始。`;
  } else if (game.phase === "decide") {
    if (spectating) {
      headline = `等 ${pending.length} 人决定`;
    } else if (!me?.inTemple) {
      headline = `等 ${pending.length} 人决定`;
      detail = "你这局已经回营地了，看他们还挖不挖。";
    } else if (autoPlaying) {
      headline = "托管中";
      detail = "人机正在替你选，点「取消托管」拿回来。";
    } else if (!me.decided) {
      headline = "继续挖还是回营地？";
      detail = amLast ? "你是最后一个：点了就一起亮出。" : "大家同时选，都选好了一起亮出；最后一个人选之前都能改。";
    } else {
      headline = `你选了${me.choice === "stay" ? "继续挖" : "回营地"}`;
      detail = pending.length ? `等 ${pending.length} 人（${pending.map((player) => nameOf(player.id)).join("、")}）；之前都能改或撤回。` : "";
    }
  }

  // ---------- 侧栏 ----------
  const sideTabs = useSideTabs(room);
  const [drawer, setDrawer] = useState(false);
  const showSide = layout.side || drawer || layout.mobile;
  const showTimer = secondsLeft !== null && game.phase === "decide";

  const action = (
    <ActionBar
      game={game}
      me={me}
      layout={layout}
      spectating={spectating}
      autoPlaying={autoPlaying}
      canDecide={canDecide}
      actions={actions}
      busy={busy}
      amLast={amLast}
      chance={chance}
      seconds={showTimer ? secondsLeft : null}
      headline={headline}
      detail={detail}
      error={error || shownNotice}
      isError={!!error}
      seeAll={room.access.spectatorsSeeAll}
      onDecide={decide}
      onUndecide={undecide}
      onAuto={onAuto}
      onLeave={onLeave}
      showAuto={mode !== "practice"}
      extra={
        <>
          {actionExtra}
          {canHint && (
            <button className={shownHint ? "quiet-button ig-hint on" : "quiet-button ig-hint"} type="button" data-tutorial="hint" onClick={toggleHint} title="人机会怎么选（键盘 H）">
              提示
            </button>
          )}
        </>
      }
    />
  );

  const side = (
    <aside className="ig-side">
      <section className="ig-panel ig-status" data-tutorial="status">
        <h2>{headline}</h2>
        {detail && <p>{detail}</p>}
        {(error || shownNotice) && <p className={error ? "ig-feedback error" : "ig-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}
      </section>
      {mode !== "online" && chat}
      <section className="ig-panel ig-tabs">
        <div className="ig-tab-bar" role="tablist">
          <button type="button" role="tab" aria-selected={sideTabs.tab === "log"} className={sideTabs.tab === "log" ? "active" : ""} onClick={() => sideTabs.setTab("log")}>记录</button>
          <button type="button" role="tab" aria-selected={sideTabs.tab === "rounds"} className={sideTabs.tab === "rounds" ? "active" : ""} onClick={() => sideTabs.setTab("rounds")} data-tutorial="rounds-tab">各局</button>
          {mode === "online" && (
            <button type="button" role="tab" aria-selected={sideTabs.tab === "chat"} className={sideTabs.tab === "chat" ? "active" : ""} onClick={() => sideTabs.setTab("chat")}>
              聊天{sideTabs.unread > 0 && <em>{sideTabs.unread}</em>}
            </button>
          )}
        </div>
        {sideTabs.tab === "log" && (log.length === 0 ? <p className="ig-muted">{game.history.length || game.departures.length ? "之前各局的结果在「各局」里。" : "还没有动作。"}</p> : <ul className="ig-log">{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>)}
        {sideTabs.tab === "rounds" && <RoundsList game={game} nameOf={nameOf} />}
        {sideTabs.tab === "chat" && <div className="ig-chat">{chat}</div>}
      </section>
    </aside>
  );

  const day = theme === "day";
  return (
    <div
      className={["ig-screen", layout.mobile ? "mobile" : "", layout.side ? "with-side" : ""].join(" ")}
      style={{ "--fx-crack": `url(${art.fx.crack})`, "--fx-collapse": `url(${art.fx.collapse})`, "--fx-torch": `url(${art.fx.torch})` } as CSSProperties}
    >
      <header className="ig-topbar">
        {brand}
        <div className="ig-turn" data-tutorial="turn">
          <RoundPips game={game} />
          <span className={myTurn ? "ig-turn-text mine" : "ig-turn-text"}>{myTurn && layout.mobile ? "轮到你选" : headline}</span>
          {showTimer && <b className={secondsLeft! <= 10 ? "ig-timer low" : "ig-timer"} data-tutorial="timer">{secondsLeft}s</b>}
        </div>
        <div className="ig-topbar-right">
          {themeToggle}
          <GameRules />
          <GameRoomMenu room={room} />
          {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {!layout.side && !layout.mobile && (
            <button className="quiet-button ig-drawer-toggle" type="button" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
              记录 / 聊天{sideTabs.unread > 0 ? ` · ${sideTabs.unread}` : ""}
            </button>
          )}
          {connection}
        </div>
      </header>

      <div className="ig-main" ref={mainRef}>
        <div
          className="ig-table"
          style={{
            "--scene": `url(${art.scene(day)})`,
            "--scene-size": coverSize(mainBox.width, mainBox.height),
            "--floor": `url(${art.floor(day)})`,
          } as CSSProperties}
        >
          <InfoBar game={game} layout={layout} refs={{ gems: (el) => { gemsEl.current = el; } }} />
          <PathView
            game={game}
            layout={layout}
            width={pathWidth(layout, mainBox.width)}
            players={game.players}
            fx={pathFx}
            cardRef={cardRef}
            slotRef={(el) => { slotEl.current = el; }}
            explorersIn={explorersIn}
            overlay={roundOver && !finished ? <RoundSummary game={game} me={me} startTent={roundStartTent.current.get(game.round)} nameOf={nameOf} /> : null}
          />
          {layout.mobile && action}
          <Camp game={game} layout={layout} members={memberOf} selfId={selfId} fx={{ floats, glow }} tentRef={tentRef} spectating={spectating} />
          {!layout.mobile && action}
          {toast && <div key={toast.key} className={`ig-toast ${toast.tone}`} role="status">{toast.text}</div>}
        </div>
        {showSide && side}
        <div className="ig-fx" ref={fxRef} aria-hidden="true">
          {flights.map((flight) => (
            <span
              key={flight.id}
              className={`ig-flight ${flight.kind}`}
              style={{
                left: flight.x,
                top: flight.y,
                "--dx": `${flight.dx}px`,
                "--dy": `${flight.dy}px`,
                "--fs": flight.s,
                animationDelay: `${flight.delay}ms`,
                ...(flight.kind === "artifact" ? { backgroundImage: `url(${art.icon("artifact")})` } : { backgroundImage: `url(${art.fx.gem})` }),
              } as CSSProperties}
            />
          ))}
          {sparks.map((item) => (
            <span key={item.id} className="ig-spark" style={{ left: item.x, top: item.y, "--fs": item.s, animationDelay: `${item.delay}ms`, backgroundImage: `url(${art.fx.sparkle})` } as CSSProperties} />
          ))}
        </div>
      </div>

      {finished && <FinalDialog game={game} room={room} selfId={selfId} memberId={memberId} spectating={spectating} nameOf={nameOf} colorOf={colorOf} onRematch={onRematch} onLeave={onLeave} actions={finalActions} />}
      {shownHint && (
        <Coach
          view={{
            key: `hint-${game.version}`,
            say: shownHint.say,
            ...(shownHint.note ? { note: shownHint.note } : {}),
            anchor: shownHint.anchor,
            focus: false,
            face: "think",
            actions: <button className="quiet-button" type="button" onClick={() => setHint(null)}>知道了</button>,
          }}
        />
      )}
      {tips.tip && <TipToast tip={tips.tip} onClose={tips.dismiss} onNever={tips.never} />}
    </div>
  );
}

/** 路径区内部可用宽度（和 layout.ts 的算法一致）。 */
function pathWidth(layout: Layout, mainWidth: number): number {
  if (layout.mobile) return mainWidth - 2 * 4;
  const tableW = mainWidth - (layout.side ? 300 + 12 : 0);
  return tableW - 2 * 12 - 2 * 10;
}

function initialLog(game: GameState, nameOf: (id: string) => string, selfId: string) {
  return game.events
    .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, game, nameOf, selfId) }))
    .filter((line): line is { key: string; text: string } => line.text !== null)
    .reverse();
}

/** 侧栏的「记录 / 各局 / 聊天」切换和聊天未读数。 */
function useSideTabs(room: LobbyRoomSnapshot) {
  const [tab, setTab] = useState<"log" | "rounds" | "chat">("log");
  const [seen, setSeen] = useState(room.chat.length);
  const unread = tab === "chat" ? 0 : Math.max(0, room.chat.length - seen);
  useEffect(() => {
    if (tab === "chat") setSeen(room.chat.length);
  }, [tab, room.chat.length]);
  return {
    tab,
    setTab: (next: "log" | "rounds" | "chat") => {
      setTab(next);
      if (next === "chat") setSeen(room.chat.length);
    },
    unread,
  };
}

/** 顶栏的 5 个神庙：打完的压暗（塌方的打红叉），当前这局加金框。 */
function RoundPips({ game }: { game: GameState }) {
  return (
    <span className="ig-pips" title={`第 ${game.round} / ${game.config.rounds} 局`} aria-label={`第 ${game.round} / ${game.config.rounds} 局`} data-tutorial="rounds">
      {Array.from({ length: game.config.rounds }, (_, index) => {
        const round = index + 1;
        const result = game.history.find((item) => item.round === round);
        const state = result ? (result.reason === "collapse" ? "done bust" : "done") : round === game.round && game.phase !== "gameOver" ? "now" : "";
        return (
          <span key={round} className={`ig-pip ${state}`} title={result ? `第 ${round} 局：${result.reason === "collapse" ? `${HAZARD_NAMES[result.hazard!]}塌方` : "大家都回营地"}` : `第 ${round} 局`}>
            <Icon name="temple" s={1} />
          </span>
        );
      })}
      <b className="ig-round-num">{game.round}<i>/{game.config.rounds}</i></b>
    </span>
  );
}

/** 操作条：两个大按钮、倒计时、自己的数字；不能决定时换成说明。 */
function ActionBar({ game, me, layout, spectating, autoPlaying, canDecide, actions, busy, amLast, chance, seconds, headline, detail, error, isError, seeAll, onDecide, onUndecide, onAuto, onLeave, showAuto, extra }: {
  game: GameState;
  me: Player | null;
  layout: Layout;
  spectating: boolean;
  autoPlaying: boolean;
  canDecide: boolean;
  actions: GameCommand[];
  busy: boolean;
  amLast: boolean;
  chance: number;
  seconds: number | null;
  headline: string;
  detail: string;
  error: string;
  isError: boolean;
  seeAll: boolean;
  onDecide: (choice: Choice) => void;
  onUndecide: () => void;
  onAuto: (enabled: boolean) => void;
  onLeave: () => void;
  /** 练习局里没有托管（人机就在旁边，托管没意义）。 */
  showAuto: boolean;
  extra?: ReactNode;
}) {
  const finished = game.phase === "gameOver";
  const iconS = layout.mobile ? 1 : 2;
  const choice = me?.decided ? me.choice : null;
  const leavePreview = (() => {
    if (!me) return "";
    const text = game.pathGems > 0 ? `带回 ${me.carried} 颗 + 路上 ${game.pathGems} 颗平分` : `带回 ${me.carried} 颗`;
    if (game.pathArtifacts.length > 0) {
      const value = game.pathArtifacts.reduce((sum, _, index) => sum + (game.artifactsClaimed + index + 1 <= 3 ? 5 : 10), 0);
      return `${text} · 独走拿神器 ${value} 分`;
    }
    return text;
  })();
  const stats = me && (
    <div className="ig-mine" data-tutorial="my-stats">
      <span title="这局手上的宝石（回营地才存进帐篷；塌方就丢）"><Icon name="gem" s={iconS} /><small>手上</small><b>{me.inTemple && !finished ? me.carried : 0}</b></span>
      <span title="帐篷里的宝石：存进去就不会丢，只有你看得到" data-tutorial="my-tent-gems"><Icon name="tent" s={iconS} /><small>帐篷</small><b>{me.tent ?? 0}</b></span>
      {!game.config.noArtifacts && (
        <span title={me.artifacts.length ? me.artifacts.map((claim) => `「${artifactName(claim.artifact)}」${claim.value} 分`).join("、") : "还没带出神器"}><Icon name="artifact" s={iconS} /><small>神器</small><b>{me.artifacts.reduce((sum, claim) => sum + claim.value, 0)}<i>分</i></b></span>
      )}
    </div>
  );

  let body: ReactNode;
  if (spectating) {
    body = (
      <div className="ig-action-note">
        <strong>观战中</strong>
        <span>{seeAll ? "房主开了观战看帐篷：能看到每个人帐篷里的宝石" : "只看公开信息：帐篷里的宝石看不到"}</span>
      </div>
    );
  } else if (finished) {
    body = <div className="ig-action-note"><strong>探险结束</strong><span>看结算；同意的人都点了「再来一局」就开新的一局。</span></div>;
  } else if (autoPlaying) {
    body = (
      <div className="ig-action-note auto" data-tutorial="auto-note">
        <strong>托管中</strong>
        <span>人机正在替你选。</span>
        <button className="primary-button ig-cancel-auto" type="button" onClick={() => onAuto(false)} data-tutorial="btn-cancel-auto">取消托管</button>
      </div>
    );
  } else if (canDecide) {
    body = (
      <div className="ig-choices" data-tutorial="choices">
        <button
          type="button"
          className={["ig-choice-btn", "stay", choice === "stay" ? "chosen" : "", choice === "leave" ? "other" : ""].join(" ")}
          disabled={busy || (choice !== "stay" && !actions.some((command) => command.type === "decide" && command.choice === "stay"))}
          aria-pressed={choice === "stay"}
          onClick={() => onDecide("stay")}
          data-tutorial="btn-stay"
          title="继续挖（键盘 1 或 ←）"
        >
          <Px src={art.choiceIcon("stay")} w={32} h={32} s={iconS} />
          <span><b>{choice === "stay" ? "已选继续" : "继续挖"}</b><small className={bustTone(chance)}>下一张塌方 {percent(chance)}</small></span>
        </button>
        <button
          type="button"
          className={["ig-choice-btn", "leave", choice === "leave" ? "chosen" : "", choice === "stay" ? "other" : ""].join(" ")}
          disabled={busy || (choice !== "leave" && !actions.some((command) => command.type === "decide" && command.choice === "leave"))}
          aria-pressed={choice === "leave"}
          onClick={() => onDecide("leave")}
          data-tutorial="btn-leave"
          title="回营地（键盘 2 或 →）"
        >
          <Px src={art.choiceIcon("leave")} w={32} h={32} s={iconS} />
          <span><b>{choice === "leave" ? "已选回营" : "回营地"}</b><small>{leavePreview}</small></span>
        </button>
        <div className="ig-choice-side">
          {seconds !== null && <b className={seconds <= 10 ? "ig-big-timer low" : "ig-big-timer"}>{seconds}<small>秒</small></b>}
          {choice ? (
            <button className="quiet-button" type="button" disabled={busy} onClick={onUndecide} data-tutorial="btn-undo" title="撤回（Esc）">撤回</button>
          ) : (
            <small className="ig-choice-hint">{amLast ? "你是最后一个" : "大家同时亮出"}</small>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="ig-action-note">
        <strong>{headline}</strong>
        <span>{detail}</span>
      </div>
    );
  }
  return (
    <section className={`ig-action ${canDecide ? "live" : ""}`} data-tutorial="action-bar">
      {body}
      {stats}
      <div className="ig-action-tools">
        {showAuto && !spectating && !finished && !autoPlaying && <button className="quiet-button" type="button" onClick={() => onAuto(true)} title="让人机替你选，随时可以取消" data-tutorial="btn-auto">托管</button>}
        <span className="ig-hint-slot" data-tutorial="hint-slot">{extra}</span>
      </div>
      {error && <p className={isError ? "ig-feedback error ig-action-feedback" : "ig-feedback ig-action-feedback"} role={isError ? "alert" : "status"}>{error}</p>}
    </section>
  );
}

/** 各局结果（公开信息）：怎么结束的、翻了几张、谁被困、谁什么时候回营地、谁拿了神器。不写别人带回几颗。 */
function RoundsList({ game, nameOf }: { game: GameState; nameOf: (id: string) => string }) {
  const rounds = Array.from({ length: game.round }, (_, index) => index + 1);
  return (
    <ol className="ig-rounds">
      {rounds.map((round) => {
        const result = game.history.find((item) => item.round === round);
        const departures = game.departures.filter((item) => item.round === round);
        return (
          <li key={round}>
            <strong>
              第 {round} 局{result ? (result.reason === "collapse" ? ` · ${HAZARD_NAMES[result.hazard!]}塌方` : " · 都回营地") : " · 进行中"}
              {result && <small> · 翻了 {result.cards} 张</small>}
            </strong>
            {departures.map((departure, index) => (
              <span key={index}>
                第 {departure.after} 张后：{departure.players.map(nameOf).join("、")} 回营地
                {departure.artifacts.length > 0 && `，拿走神器 ${departure.artifacts.map((claim) => `「${artifactName(claim.artifact)}」${claim.value}分`).join("")}`}
              </span>
            ))}
            {result && result.caught.length > 0 && <span className="bad">被困：{result.caught.map(nameOf).join("、")}，每人丢 {result.lostGems} 颗</span>}
            {departures.length === 0 && !result && <span>还没人回营地</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** 局末小结：叠在牌桌中间，几秒后自动开下一局。只写自己带回几颗，别人的只写公开信息。 */
function RoundSummary({ game, me, startTent, nameOf }: { game: GameState; me: Player | null; startTent: number | undefined; nameOf: (id: string) => string }) {
  const result = game.history.at(-1)!;
  const gained = me && me.tent !== null && startTent !== undefined ? me.tent - startTent : null;
  const trapped = me ? result.caught.includes(me.id) : false;
  const mine = game.departures.filter((departure) => departure.round === game.round && me && departure.players.includes(me.id)).flatMap((departure) => departure.artifacts);
  const lost = [
    result.pathGemsDiscarded ? `路上 ${result.pathGemsDiscarded} 颗作废` : "",
    result.artifactsDiscarded.length ? `神器${result.artifactsDiscarded.map((id) => `「${artifactName(id)}」`).join("")}作废` : "",
  ].filter(Boolean);
  return (
    <div className="ig-summary" role="status" data-tutorial="round-summary">
      <div className="ig-summary-banner" style={{ backgroundImage: `url(${art.banner})` }}>第 {result.round} 局结束</div>
      <p className={result.reason === "collapse" ? "bad big" : "big"}>
        {result.reason === "collapse" ? `${HAZARD_NAMES[result.hazard!]}第二次出现，塌方！` : "大家都回营地了"}
      </p>
      {result.caught.length > 0 && <p>被困：{result.caught.map(nameOf).join("、")}（这局的 {result.lostGems} 颗丢了）</p>}
      {me && (
        <p className="gold big">
          {trapped ? "你这局白干了" : gained !== null ? `你这局带回 ${gained} 颗` : "你这局平安回营地"}
          {mine.length > 0 && ` · 神器 ${mine.map((claim) => `${claim.value} 分`).join(" + ")}`}
        </p>
      )}
      {lost.length > 0 && <p className="muted">{lost.join("，")}</p>}
      <p className="muted">{game.round >= game.config.rounds ? "马上结算……" : `第 ${game.round + 1} 局马上开始${result.hazard ? `（${HAZARD_NAMES[result.hazard]}永久少一张）` : ""}`}</p>
    </div>
  );
}

// ---------- 终局 ----------

function FinalDialog({ game, room, selfId, memberId, spectating, nameOf, colorOf, onRematch, onLeave, actions }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  selfId: string;
  /** 自己在 room.members 里的 id（再来一局的同意名单按它记）。 */
  memberId: string;
  /** 教程练习局：替代「再来一局」的按钮。 */
  actions?: ReactNode;
  spectating: boolean;
  nameOf: (id: string) => string;
  colorOf: (id: string) => ReturnType<typeof seatColor>;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(memberId) ?? false;
  const [hidden, setHidden] = useState(false);
  if (hidden) {
    return <button className="primary-button ig-show-final" type="button" onClick={() => setHidden(false)}>看结算</button>;
  }
  const won = result.winners.includes(selfId);
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel ig-final" role="dialog" aria-modal="true" aria-labelledby="ig-final-title" data-tutorial="final">
        <div className="ig-final-head">
          <Px src={art.chest} w={64} h={48} s={2} className="ig-chest" />
          <div className="ig-final-banner" style={{ backgroundImage: `url(${art.banner})` }}>
            <h2 id="ig-final-title">{won ? (result.winners.length > 1 ? "并列第一！" : "你赢了！") : "探险结束"}</h2>
          </div>
        </div>
        <ol className="ig-standings">
          {result.scores.map((score) => {
            const winner = result.winners.includes(score.player);
            const tied = result.scores.some((other) => other !== score && other.total === score.total);
            return (
              <li key={score.player} className={winner ? "winner" : ""} style={{ "--seat": SEAT_HEX[colorOf(score.player)] } as CSSProperties}>
                <span className="ig-rank">{winner ? <Icon name="crown" s={2} /> : score.rank}</span>
                <span className="ig-standing-name">
                  <strong>{nameOf(score.player)}</strong>
                  <small>
                    宝石 {score.gems}
                    {!game.config.noArtifacts && ` + 神器 ${score.artifactPoints} 分（${score.artifacts.length} 件）`}
                    {tied && !game.config.noArtifacts && " · 同分比神器件数"}
                  </small>
                </span>
                <span className="ig-standing-arts">{score.artifacts.map((claim) => <Px key={claim.order} src={art.badge(claim.value)} w={20} h={20} s={1} title={`「${artifactName(claim.artifact)}」第 ${claim.order} 件 ${claim.value} 分`} />)}</span>
                <b className="ig-final-score">{score.total}</b>
              </li>
            );
          })}
        </ol>
        {result.winners.length > 1 && <p className="ig-final-note">总分和神器件数都一样，并列获胜。</p>}
        {spectating ? (
          <div className="ig-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看牌桌</button>
              <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
            </div>
          </div>
        ) : actions ? (
          <div className="ig-rematch">
            <span>练习局打完了。</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看牌桌</button>
              {actions}
            </div>
          </div>
        ) : room.rematch && (
          <div className="ig-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看牌桌</button>
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)} data-tutorial="btn-rematch">{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
