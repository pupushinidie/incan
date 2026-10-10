/**
 * 预览页（开发时打开 /preview.html）：用规则包的预览局面工厂造局面，渲染真正的牌桌 / 等候房间，不用真打一局去等。
 *
 * 参数：
 *   ?s=场景名（规则包的 SCENE_LIST，加上下面 UI_SCENES、ROOM_SCENES 里的）
 *   &v=从谁的座位看（p1…，空 = 观战；默认 p1）
 *   &offline=p3,p4 &bots=p2 &auto=p1（托管中的座位）&t=倒计时毫秒（空 = 不显示）&all=1（观战看帐篷）
 *   &err=文字（操作条上的出错提示，比如非法操作）
 *   &from=场景名（先显示这个场景，0.8 秒后换成 s，用来看翻牌、亮拳、回营地、塌方这些动画）
 *   &chat=1（聊天里放几条示例消息，侧栏切到聊天）
 *   &nav=0（不显示顶上的场景导航，截图用）
 *   &tut=none / again（等候房间的新手教程入口：不放 / 学过以后的小按钮；默认是第一次来的邀请卡）
 *
 * 界面阶段维护；教程和验收要加场景就往 UI_SCENES / ROOM_SCENES 里加，不要删别人的。生产构建只打包 index.html，不带这个页面。
 */
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  buildScene,
  DEFAULT_ROOM_ACCESS,
  previewRoom,
  previewScene,
  previewSocketId,
  SCENE_LIST,
  SCENES,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type SceneName,
} from "@incan/game";
import { Brand, ConnectionStatus, RoomView } from "./App.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import GameRules from "./GameRules.js";
import RoomChat from "./RoomChat.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import { TutorialInvite } from "./tutorial/Invite.js";
import { useVoice } from "./voice.js";
import "./styles.css";
import "./app-pixel.css";
import "./incan.css";
import "./theme-day.css";

applyTheme(readTheme());

/** 界面阶段补的牌桌局面（规则包的 SCENES 之外）。 */
const LONG_PATH = [11, "fire", 7, "A1", 5, "mummy", 3, "A2", 14, "rocks", 2, "A3", 9, "snake", 13, "A4", 1, "spider", 15, "A5", 4, 17, 5, 7, 11] as const;
const UI_SCENES: Record<string, { title: string; build: () => GameState }> = {
  longPath: {
    title: "8 人第 5 局，路上 25 张牌（理论最长）：有人单独拿走过神器、有人两人一起走，还剩 4 人在神庙里决定",
    build: () =>
      buildScene({
        players: ["阿宝", "小王", "咕噜一号", "阿杰", "Momo", "老张", "咕噜二号", "七七"],
        round: 5,
        tentsBefore: { p1: 30, p2: 22, p3: 41, p4: 18, p5: 27, p6: 35, p7: 12, p8: 24 },
        path: [...LONG_PATH],
        leftAfter: { p2: 5, p3: 9, p4: 9, p5: 16 },
        choices: { p6: "stay", p8: "leave" },
      }),
  },
  longCollapse: {
    title: "8 人第 5 局，路上 26 张，最后一张第二张火焰塌方（版图铺满的局末）",
    build: () =>
      buildScene({
        players: ["阿宝", "小王", "咕噜一号", "阿杰", "Momo", "老张", "咕噜二号", "七七"],
        round: 5,
        tentsBefore: { p1: 30, p2: 22, p3: 41, p4: 18, p5: 27, p6: 35, p7: 12, p8: 24 },
        path: [...LONG_PATH, "fire"],
        leftAfter: { p2: 5, p3: 9, p4: 9, p5: 16, p8: 22 },
      }),
  },
  lastDecider: {
    title: "别人都决定了，只差你一个（点了就亮出）",
    build: () => buildScene({ players: 4, path: [9, "fire", 4], choices: { p2: "stay", p3: "leave", p4: "stay" } }),
  },
  myStay: {
    title: "你选了继续挖（可以改选、撤回），等别人",
    build: () => buildScene({ players: 5, path: [14, "spider", "artifact", 7], choices: { p1: "stay", p3: "leave" } }),
  },
  meLeft: {
    title: "你这局已经回营地了，看别人决定",
    build: () => buildScene({ players: 5, tentsBefore: { p1: 9 }, path: [7, "snake", 11, 5], leftAfter: { p1: 3 }, choices: { p2: "stay" } }),
  },
  threePlayers: {
    title: "3 人局：路上有神器，决定中",
    build: () => buildScene({ players: 3, path: [13, "artifact", "rocks"] }),
  },
  roundStart3: {
    title: "第 3 局开局（前两局各塌方一次）",
    build: () =>
      buildScene({
        players: 4,
        round: 3,
        removed: { fire: 1, snake: 1 },
        tentsBefore: { p1: 12, p2: 20, p3: 8, p4: 15 },
        claimsBefore: [{ player: "p2", artifact: 1 }],
        lostBefore: [2],
        history: [
          { round: 1, reason: "collapse", hazard: "fire", caught: ["p3", "p4"], lostGems: 6, pathGemsDiscarded: 1, artifactsDiscarded: [], cards: 9 },
          { round: 2, reason: "collapse", hazard: "snake", caught: ["p1"], lostGems: 11, pathGemsDiscarded: 2, artifactsDiscarded: [2], cards: 12 },
        ],
      }),
  },
  // 教程、验收要加的场景往下加
};

/** 等候房间的局面（status = waiting）。 */
const ROOM_SCENES: Record<string, { title: string; members: { name: string; bot?: boolean; connected?: boolean }[]; capacity: 3 | 4 | 5 | 6 | 7 | 8; viewer?: number; noArtifacts?: boolean }> = {
  room1: { title: "等候房间：只有房主一个人", members: [{ name: "阿宝" }], capacity: 4 },
  roomBots: { title: "等候房间：房主加了 2 个人机，可以开始", members: [{ name: "阿宝" }, { name: "咕噜一号", bot: true }, { name: "咕噜二号", bot: true }], capacity: 4 },
  roomFull: {
    title: "等候房间：8 人满员（含 3 个人机），开了无神器",
    members: [{ name: "阿宝" }, { name: "小王" }, { name: "咕噜一号", bot: true }, { name: "阿杰" }, { name: "Momo" }, { name: "咕噜二号", bot: true }, { name: "老张", connected: false }, { name: "咕噜三号", bot: true }],
    capacity: 8,
    noArtifacts: true,
  },
  roomGuest: { title: "等候房间：你是客人（不是房主）", members: [{ name: "小王" }, { name: "阿宝" }, { name: "阿杰" }], capacity: 6, viewer: 1 },
};

const params = new URLSearchParams(window.location.search);
const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
const ALL = [...SCENE_LIST, ...Object.keys(UI_SCENES), ...Object.keys(ROOM_SCENES)];
const requested = params.get("s") ?? "deciding";
const name = ALL.includes(requested) ? requested : "deciding";
const viewer = params.has("v") ? params.get("v")! : "p1";
const timer = params.get("t");
const showNav = params.get("nav") !== "0";

function sceneTitle(scene: string): string {
  if (scene in UI_SCENES) return UI_SCENES[scene]!.title;
  if (scene in ROOM_SCENES) return ROOM_SCENES[scene]!.title;
  return SCENES[scene as SceneName]?.title ?? scene;
}

function buildGame(scene: string): GameState {
  if (scene in UI_SCENES) return UI_SCENES[scene]!.build();
  return previewScene(scene as SceneName);
}

const SAMPLE_CHAT = [
  { id: "c1", senderId: previewSocketId("p2"), name: "小王", message: "这把我先跑了哈", createdAt: new Date().toISOString() },
  { id: "c2", senderId: previewSocketId("p1"), name: "阿宝", message: "再挖一张！", createdAt: new Date().toISOString() },
  { id: "c3", senderId: "sock-watch-0", name: "路人", message: "火焰已经出过了，小心", createdAt: new Date().toISOString(), spectator: true },
];

function gameRoom(scene: string): LobbyRoomSnapshot {
  const room = previewRoom(buildGame(scene), {
    viewer,
    offline: list("offline"),
    bots: list("bots"),
    auto: list("auto"),
    spectatorsSeeAll: params.get("all") === "1",
    ...(timer !== null ? { turnRemainingMs: timer === "" ? null : Number(timer) } : {}),
    ...(params.has("rematch") ? { rematchAccepted: list("rematch") } : {}),
  });
  return params.get("chat") === "1" ? { ...room, chat: SAMPLE_CHAT } : room;
}

function waitingRoom(scene: string): LobbyRoomSnapshot {
  const spec = ROOM_SCENES[scene]!;
  const me = spec.viewer ?? 0;
  const members: LobbyMember[] = spec.members.map((member, index) => ({
    id: previewSocketId(`p${index + 1}`),
    playerId: `p${index + 1}`,
    name: member.name,
    isHost: index === 0,
    connected: member.connected ?? true,
    ...(member.bot ? { bot: true } : {}),
  }));
  Object.defineProperty(socket, "id", { value: previewSocketId(`p${me + 1}`), configurable: true });
  return {
    code: "K7Q2TX",
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    capacity: spec.capacity,
    options: { noArtifacts: spec.noArtifacts ?? false },
    status: "waiting",
    members,
    chat: params.get("chat") === "1" ? SAMPLE_CHAT : [],
    voice: [],
  };
}

// 冒充自己：牌桌按 socket.id 找自己的座位
Object.defineProperty(socket, "id", { value: previewSocketId(viewer), configurable: true });

function Nav() {
  if (!showNav) return null;
  return (
    <nav className="ig-preview-nav" style={{ position: "fixed", zIndex: 2000, left: 0, right: 0, bottom: 0, display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 8px", fontSize: 12, background: "rgba(5,10,11,.85)" }}>
      {ALL.map((scene) => (
        <a key={scene} href={`?s=${scene}&v=${viewer}`} title={sceneTitle(scene)} style={{ color: scene === name ? "#f0c050" : "#a7b6a0" }}>{scene}</a>
      ))}
      <span style={{ color: "#f1ece0" }}>· {sceneTitle(name)}</span>
    </nav>
  );
}

function PreviewGame() {
  const [theme, toggleTheme] = useTheme();
  const [confirm, confirmDialog] = useConfirm();
  const from = params.get("from");
  const [scene, setScene] = useState(from && ALL.includes(from) ? from : name);
  const [room, setRoom] = useState(() => gameRoom(scene));
  useEffect(() => {
    if (scene === name) return;
    const timerId = window.setTimeout(() => {
      setScene(name);
      // 动画看的是 version 变没变：目标局面的 version 比来源大
      const next = gameRoom(name);
      setRoom({ ...next, game: { ...next.game!, version: Math.max(next.game!.version, room.game!.version + 1) } });
    }, 800);
    return () => window.clearTimeout(timerId);
  }, []);
  const voice = useVoice(null);
  return (
    <main className="app-shell ig-game">
      <GameBoard
        room={room}
        busy={false}
        error={params.get("err") ?? ""}
        notice=""
        brand={<Brand />}
        connection={<ConnectionStatus connected />}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        theme={theme}
        chat={<RoomChat room={room} voice={voice} />}
        onCommand={(command) => console.log("command", command)}
        onRematch={() => {}}
        onAuto={() => {}}
        onDissolve={() => { void confirm({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" }); }}
        watchId=""
        onWatch={() => {}}
        onLeave={() => {}}
      />
      {confirmDialog}
      <Nav />
    </main>
  );
}

function PreviewRoom() {
  const [theme, toggleTheme] = useTheme();
  const [confirm, confirmDialog] = useConfirm();
  const room = waitingRoom(name);
  const voice = useVoice(null);
  return (
    <main className="app-shell ig-room">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <GameRules />
          <ConnectionStatus connected />
        </div>
      </header>
      <RoomView
        room={room}
        busy={false}
        error={params.get("err") ?? ""}
        notice=""
        onCopyCode={() => {}}
        onLeave={() => {}}
        onStart={() => {}}
        onKick={() => {}}
        onAddBot={() => {}}
        onDissolve={() => { void confirm({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" }); }}
        chat={<RoomChat room={room} voice={voice} />}
        tutorial={
          params.get("tut") === "none" ? undefined : (
            <TutorialInvite
              record={params.get("tut") === "again" ? "done" : null}
              title="等人的时候，先学一下？"
              text="咕噜嘎带你在真牌桌上走一遍，不会离开房间，房主一开局就自动回来。"
              again="看新手教程"
              onOpen={() => {}}
            />
          )
        }
      />
      {confirmDialog}
      <Nav />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {name in ROOM_SCENES ? <PreviewRoom /> : <PreviewGame />}
  </React.StrictMode>,
);
