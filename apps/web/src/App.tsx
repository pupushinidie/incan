import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { CAPACITY_OPTIONS, MIN_PLAYERS, type Capacity, type Card, type GameCommand, type GameOptions, type LobbyRoomSnapshot, type PublicRoomSummary } from "@incan/game";
import { art, CARD_H, CARD_W, cardArt, seatColor, SEAT_HEX } from "./art.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import GameRules from "./GameRules.js";
import OnlineRooms from "./OnlineRooms.js";
import RoomChat from "./RoomChat.js";
import { roomRole, RoomSettingsPanel, SeatSwitch } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { ThemeToggle, useTheme } from "./theme.js";
import { useVoice } from "./voice.js";

type EntryMode = "create" | "join";

const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

// 线上游戏中心在站点根路径；本地开发时跑在 5175 端口。
const CENTER_URL = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5175/` : "/";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [confirmAction, confirmDialog] = useConfirm();
  // 白天 / 夜间画面：首页、等候房间、牌桌共用，顶栏按钮随时切换；和游戏中心、其他游戏共用同一个选择。
  const [theme, toggleTheme] = useTheme();
  const themeToggle = <ThemeToggle theme={theme} onToggle={toggleTheme} />;
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<PublicRoomSummary[]>([]);
  // 观战时从谁的座位看（默认第一位玩家）。
  const [watchId, setWatchId] = useState("");
  const voice = useVoice(room);

  // 在房间里时服务端不推送在线牌桌列表；回到首页时主动拉一次最新的。
  useEffect(() => {
    if (room || !socket.connected) return;
    socket.emit("lobby:get", (response) => {
      if (response.ok) setLobbyRooms(response.data);
    });
  }, [room === null]);

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("lobby:get", (response) => {
        if (response.ok) setLobbyRooms(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    const handleRoomUpdate = (snapshot: LobbyRoomSnapshot) => setRoom(snapshot);
    const handleRoomError = (message: string) => setError(message);
    const handleLobbyUpdate = (rooms: PublicRoomSummary[]) => setLobbyRooms(rooms);
    const handleRoomClosed = ({ reason }: { reason: string }) => {
      setRoom(null);
      setBusy(false);
      setError("");
      setNotice(reason);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", handleRoomUpdate);
    socket.on("room:error", handleRoomError);
    socket.on("lobby:updated", handleLobbyUpdate);
    socket.on("room:closed", handleRoomClosed);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", handleRoomUpdate);
      socket.off("room:error", handleRoomError);
      socket.off("lobby:updated", handleLobbyUpdate);
      socket.off("room:closed", handleRoomClosed);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  /** 从首页列表加入空座位或进去观战（用上面填的昵称）。 */
  function joinListed(roomId: string, spectate: boolean) {
    const nickname = name.trim();
    if (nickname.length < 2 || nickname.length > 18) {
      setNotice("");
      setError("先在上面填好你的昵称（2–18 个字符）。");
      document.getElementById("player-name")?.focus();
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    socket.emit("room:join", { name: nickname, roomId, spectate }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(spectate ? "正在观战。" : "已加入房间。");
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const nickname = name.trim();

    const complete = (response: { ok: true; data: LobbyRoomSnapshot } | { ok: false; error: string }) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(mode === "create"
        ? "房间已创建，可以邀请朋友加入。"
        : response.data.status === "playing" ? "已回到对局，继续游戏吧。" : "已加入房间。");
    };

    if (mode === "create") {
      socket.emit("room:create", { name: nickname, capacity }, complete);
    } else {
      socket.emit("room:join", { name: nickname, code: roomCode }, complete);
    }
  }

  function startGame() {
    setError("");
    setBusy(true);
    socket.emit("room:start", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("对局已开始，祝你好运。" );
    });
  }

  function leaveRoom() {
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(null);
      setError("");
      setNotice("已离开房间。" );
    });
  }

  function submitGameCommand(command: GameCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("game:command", command, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
    });
  }

  /** 房间管理类操作：只关心成败，界面更新由服务端广播。 */
  function roomCommand(send: (ack: (response: { ok: true; data: void } | { ok: false; error: string }) => void) => void) {
    setError("");
    send((response) => {
      if (!response.ok) setError(response.error);
    });
  }

  const kickMember = (memberId: string) => roomCommand((ack) => socket.emit("room:kick", memberId, ack));
  const addBot = () => roomCommand((ack) => socket.emit("room:add-bot", ack));
  const setAuto = (enabled: boolean) => roomCommand((ack) => socket.emit("room:auto", enabled, ack));
  const voteRematch = (accept: boolean) => roomCommand((ack) => socket.emit("room:rematch", accept, ack));
  async function dissolveRoom() {
    const ok = await confirmAction({
      title: "解散房间？",
      detail: "所有玩家都会被移出，当前对局也会结束。",
      confirmLabel: "解散",
    });
    if (ok) roomCommand((ack) => socket.emit("room:dissolve", ack));
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。" );
    } catch {
      setNotice("请手动复制房间码。" );
    }
  }

  if (room?.status === "playing" && room.game) {
    const players = room.game.players;
    const watched = players.some((player) => player.id === watchId) ? watchId : players[0]!.id;
    return (
      <main className="app-shell ig-game">
        <GameBoard
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          brand={<Brand />}
          connection={<ConnectionStatus connected={connected} />}
          themeToggle={themeToggle}
          theme={theme}
          chat={<RoomChat room={room} voice={voice} />}
          onCommand={submitGameCommand}
          onRematch={voteRematch}
          onAuto={setAuto}
          onDissolve={dissolveRoom}
          watchId={watched}
          onWatch={setWatchId}
          onLeave={leaveRoom}
        />
        {confirmDialog}
      </main>
    );
  }

  if (room) {
    return (
      <main className="app-shell ig-room">
        <header className="topbar">
          <Brand />
          <div className="topbar-right">
            {themeToggle}
            <GameRules />
            <ConnectionStatus connected={connected} />
          </div>
        </header>
        <RoomView
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          onCopyCode={copyRoomCode}
          onLeave={leaveRoom}
          onStart={startGame}
          onKick={kickMember}
          onAddBot={addBot}
          onDissolve={dissolveRoom}
          chat={<RoomChat room={room} voice={voice} />}
        />
        {confirmDialog}
      </main>
    );
  }

  return (
    <main className="app-shell ig-home">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <a className="center-link" href={CENTER_URL}>← 游戏中心</a>
          {themeToggle}
          <GameRules />
          <ConnectionStatus connected={connected} />
        </div>
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> 在线对战 · 3—8 人 · 空座可以加人机</div>
          <h1>印加宝藏</h1>
          <p className="welcome-description">
            大家一起钻进神庙，一张张翻牌分宝石。每翻一张，所有人同时决定：继续往里挖，还是带着宝石回营地？
            同一种危险出现第二次就塌方，还在里面的人这一局白干。打 5 局，帐篷里的宝石加神器分最高的人赢。
          </p>
          <ul className="ig-home-points">
            <li><b>分</b>宝物在神庙里的人之间平分，余数留在路上</li>
            <li><b>走</b>离开的人平分路上的余数，单独走还能拿神器</li>
            <li><b>爆</b>同一种危险第二次出现，里面的人全丢</li>
          </ul>
          <Hero />
        </div>

        <div className="ig-home-side">
          <section className="entry-card" aria-labelledby="entry-title">
            <div className="entry-card-heading">
              <div>
                <span className="section-kicker">准备开始</span>
                <h2 id="entry-title">进入神庙</h2>
              </div>
              <span className="step-indicator">01 <i /> 02</span>
            </div>

            <div className="mode-switch" role="tablist" aria-label="选择房间操作">
              <button
                className={mode === "create" ? "mode-tab active" : "mode-tab"}
                type="button"
                role="tab"
                aria-selected={mode === "create"}
                onClick={() => { setMode("create"); setError(""); }}
              >
                创建房间
              </button>
              <button
                className={mode === "join" ? "mode-tab active" : "mode-tab"}
                type="button"
                role="tab"
                aria-selected={mode === "join"}
                onClick={() => { setMode("join"); setError(""); }}
              >
                加入房间
              </button>
            </div>

            <form className="entry-form" onSubmit={handleSubmit}>
              <label className="field-label" htmlFor="player-name">你的昵称</label>
              <input
                id="player-name"
                className="text-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="输入 2–18 个字符"
                minLength={2}
                maxLength={18}
                autoComplete="nickname"
                required
              />

              {mode === "create" ? (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-capacity">房间人数</label>
                  <div className="capacity-options capacity-many" id="room-capacity" role="group" aria-label="选择房间人数">
                    {CAPACITY_OPTIONS.map((seats) => (
                      <button
                        key={seats}
                        type="button"
                        className={capacity === seats ? "capacity-option selected" : "capacity-option"}
                        aria-pressed={capacity === seats}
                        onClick={() => setCapacity(seats)}
                      >
                        <strong>{seats}</strong>
                        <span>位玩家</span>
                      </button>
                    ))}
                  </div>
                  <p className="field-hint">凑够 {MIN_PLAYERS} 位玩家房主就能开始，空座位可以加人机。「无神器」进房间后房主可以开。</p>
                </>
              ) : (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-code">房间码</label>
                  <input
                    id="room-code"
                    className="text-input room-code-input"
                    value={roomCode}
                    onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))}
                    placeholder="例如：7KQ2TX"
                    autoComplete="off"
                    maxLength={6}
                    required
                  />
                  <p className="field-hint">房间码为 6 位字母或数字，不含易混淆字符。掉线后用原昵称和房间码可回到进行中的对局。</p>
                </>
              )}

              {error && <p className="feedback feedback-error" role="alert">{error}</p>}
              {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

              <button className="primary-button" type="submit" disabled={!canSubmit}>
                {busy ? <><span className="spinner" /> 正在连接</> : mode === "create" ? "创建私人房间" : "加入牌桌"}
                {!busy && <span aria-hidden="true">↗</span>}
              </button>
            </form>
            <div className="entry-footnote"><span className="lock-icon">◇</span> 默认邀请制 · 房主可以设为公开</div>
          </section>
          <OnlineRooms rooms={lobbyRooms} connected={connected} busy={busy} onJoin={joinListed} />
        </div>
      </section>
    </main>
  );
}

export function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="印加宝藏首页">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brand-name">印加宝藏<span> INCAN GOLD</span></span>
    </a>
  );
}

export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "服务已连接" : "连接中…"}
    </div>
  );
}

export function RoomView({
  room,
  busy,
  error,
  notice,
  onCopyCode,
  onLeave,
  onStart,
  onKick,
  onAddBot,
  onDissolve,
  chat,
}: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  onCopyCode: () => void;
  onLeave: () => void;
  onStart: () => void;
  onKick: (memberId: string) => void;
  onAddBot: () => void;
  onDissolve: () => void;
  chat: ReactNode;
}) {
  const { isHost, spectating } = roomRole(room);
  const openSeats = Math.max(0, room.capacity - room.members.length);

  return (
    <section className="room-layout">
      <div className="room-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> {room.status === "waiting" ? "等待大厅" : "对局已创建"} · 印加宝藏</div>
          <h1>{spectating ? "你在观战。" : room.status === "waiting" ? "牌桌准备中。" : "好戏即将开始。"}</h1>
          <p>{spectating ? "等房主开始对局；有空座位时可以坐下一起玩。" : "把房间码分享给朋友，等大家就位后开始；空座位可以加人机。"}</p>
        </div>
        <div className="room-heading-actions">
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve} disabled={busy}>解散房间</button>}
          <button className="quiet-button" type="button" onClick={onLeave} disabled={busy || (room.status === "playing" && !spectating)}>
            {spectating ? "离开观战" : "离开房间"}
          </button>
        </div>
      </div>

      {room.status === "waiting" ? (
        <div className="room-grid">
          <section className="room-panel room-code-panel">
            <div className="panel-label">房间码 <span>仅分享给朋友</span></div>
            {room.code ? (
              <>
                <button className="room-code-display" type="button" onClick={onCopyCode} title="复制房间码">
                  {room.code}<span aria-hidden="true">⧉</span>
                </button>
                <div className="room-code-caption">点击复制 · 6 位邀请代码</div>
              </>
            ) : (
              <div className="room-code-caption">从首页列表进来观战，看不到房间码</div>
            )}
            <OptionsPanel room={room} />
            <DeckPreview />
          </section>

          <section className="room-panel player-panel">
            <div className="panel-topline">
              <div className="panel-label">玩家 <span>{room.members.length} / {room.capacity}</span></div>
              <span className="waiting-pill"><i /> 等待中</span>
            </div>
            <div className={room.capacity > 4 ? "player-list many" : "player-list"}>
              {room.members.map((member, index) => (
                <div className="player-row" key={member.id}>
                  <div className="player-avatar ig-member-avatar" style={{ background: SEAT_HEX[seatColor(index)], "--rim": "#f6e8b8" } as CSSProperties}>
                    <img src={art.explorer(seatColor(index))} alt="" />
                  </div>
                  <div className="player-details">
                    <strong>{member.name}{member.id === socket.id ? <small>你</small> : null}</strong>
                    <span>{member.isHost ? "房主" : member.bot ? "人机 · 普通难度" : "已加入"}</span>
                  </div>
                  {member.isHost && <span className="host-badge">房主</span>}
                  {member.bot && <span className="bot-badge">人机</span>}
                  {isHost && !member.isHost && (
                    <button className="kick-button" type="button" onClick={() => onKick(member.id)} title={`把 ${member.name} 移出房间`}>移出</button>
                  )}
                </div>
              ))}
              {Array.from({ length: openSeats }, (_, index) => (
                <div className="player-row open-seat" key={`open-${index}`}>
                  <div className="empty-avatar"><span>＋</span></div>
                  <div className="player-details"><strong>等待玩家加入</strong><span>{room.access.open ? "公开房间，路过的人也能加入" : "分享房间码邀请朋友"}</span></div>
                  {isHost && <button className="quiet-button add-bot-button" type="button" onClick={onAddBot} disabled={busy}>加人机</button>}
                </div>
              ))}
            </div>
            <p className="field-hint">每翻一张牌有 30 秒决定继续还是离开，超时按「离开」处理；连续超时 2 次转托管，掉线时由人机代下，回来能接上。</p>
            <RoomSettingsPanel room={room} />
            <SeatSwitch room={room} />
            <div className="room-actions">
              {isHost ? (
                <button className="primary-button" type="button" onClick={onStart} disabled={busy || room.members.length < MIN_PLAYERS}>
                  {busy ? <><span className="spinner" /> 正在开始</> : "开始对局"}<span aria-hidden="true">↗</span>
                </button>
              ) : (
                <div className="host-wait-note"><span className="pulse-dot" /> {spectating ? "等房主开始，开始后在这里观战" : "等待房主开始对局"}</div>
              )}
              {isHost && room.members.length < MIN_PLAYERS && <p className="field-hint centered">还需要至少 {MIN_PLAYERS - room.members.length} 位玩家加入，也可以点空座位上的「加人机」。</p>}
            </div>
          </section>
          <div className="ig-room-chat">{chat}</div>
        </div>
      ) : null}

      {error && <p className="feedback feedback-error room-feedback" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success room-feedback" role="status">{notice}</p>}
      <div className="room-secure-note"><span>◇</span> {room.access.open ? "公开房间：首页列表里的人可以直接加入空座位。" : "邀请制：要有房间码才能加入；首页列表不显示房间码。"}</div>
    </section>
  );
}


type Ack = { ok: true; data: void } | { ok: false; error: string };

/** 首页主图：神庙场景 + 一条路上的几张牌 + 营地的几顶帐篷。 */
function Hero() {
  const [theme] = useTheme();
  const cards: Card[] = [
    { kind: "treasure", gems: 11 },
    { kind: "hazard", hazard: "fire" },
    { kind: "artifact", artifact: 1 },
    { kind: "treasure", gems: 7 },
    { kind: "hazard", hazard: "snake" },
  ];
  return (
    <div className="ig-hero" style={{ backgroundImage: `url(${art.scene(theme === "day")})` }}>
      <div className="ig-hero-camp" aria-hidden="true">
        {[0, 1, 2, 3].map((seat) => <img key={seat} className="ig-px" src={art.tent(seatColor(seat), seat % 2 === 1)} width={64} height={48} alt="" />)}
      </div>
      <div className="ig-hero-cards" aria-hidden="true">
        {cards.map((card, index) => (
          <span key={index} style={{ "--i": index } as CSSProperties}><img className="ig-px" src={cardArt(card)} width={CARD_W * 2} height={CARD_H * 2} alt="" /></span>
        ))}
      </div>
    </div>
  );
}

/** 等候房间里的「牌一览」：三类牌各一张，配一句话。 */
function DeckPreview() {
  const items: { card: Card; label: string }[] = [
    { card: { kind: "treasure", gems: 9 }, label: "宝物 15 张" },
    { card: { kind: "hazard", hazard: "mummy" }, label: "危险 5×3" },
    { card: { kind: "artifact", artifact: 3 }, label: "神器 5 件" },
  ];
  return (
    <div className="ig-room-preview" data-tutorial="deck-preview">
      {items.map((item) => (
        <figure key={item.label}><img className="ig-px" src={cardArt(item.card)} width={CARD_W} height={CARD_H} alt="" /><figcaption>{item.label}</figcaption></figure>
      ))}
      <figure><img className="ig-px" src={art.badge(5)} width={40} height={40} alt="" /><figcaption>第 1–3 件</figcaption></figure>
      <figure><img className="ig-px" src={art.badge(10)} width={40} height={40} alt="" /><figcaption>第 4–5 件</figcaption></figure>
    </div>
  );
}

/** 开房变体：房主在等候房间里开关，其他人只看。 */
function OptionsPanel({ room }: { room: LobbyRoomSnapshot }) {
  const { isHost } = roomRole(room);
  const [error, setError] = useState("");
  const change = (patch: Partial<GameOptions>) => socket.emit("room:settings", patch, (response: Ack) => setError(response.ok ? "" : response.error));
  const items: { key: keyof GameOptions; title: string; note: string; disabled?: boolean }[] = [
    { key: "noArtifacts", title: "无神器", note: "法/德原版玩法：整局不放神器，只比宝石" },
  ];
  return (
    <div className="ig-options">
      <div className="panel-label">开房选项 <span>{isHost ? "房主可以改" : "只有房主能改"}</span></div>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={room.options[item.key] && !item.disabled ? "room-setting on" : "room-setting"}
          aria-pressed={room.options[item.key] && !item.disabled}
          disabled={!isHost || item.disabled}
          onClick={() => change({ [item.key]: !room.options[item.key] } as Partial<GameOptions>)}
        >
          <i aria-hidden="true" />
          <span><b>{item.title}</b><small>{item.note}</small></span>
        </button>
      ))}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
    </div>
  );
}

export default App;
