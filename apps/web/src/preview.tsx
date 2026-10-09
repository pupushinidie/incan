/**
 * 预览页（开发时打开 /preview.html）：用规则包的预览局面工厂造局面，渲染真正的牌桌，不用真打一局去等。
 * 参数：?s=场景名（见 SCENE_LIST）&v=从谁的座位看（p1…，空 = 观战）&offline=p3,p4&bots=p2&auto=p3&t=倒计时毫秒&all=1（观战看帐篷）
 * 引擎阶段放的最小版；界面阶段维护（加场景、截图），教程和验收要加场景就往里加，不要删别人的。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { previewRoom, previewScene, previewSocketId, SCENE_LIST, SCENES, type SceneName } from "@incan/game";
import GameBoard from "./GameBoard.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import "./styles.css";
import "./app-pixel.css";
import "./incan.css";
import "./theme-day.css";

applyTheme(readTheme());

const params = new URLSearchParams(window.location.search);
const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
const name = (SCENE_LIST as string[]).includes(params.get("s") ?? "") ? (params.get("s") as SceneName) : "deciding";
const viewer = params.has("v") ? params.get("v")! : "p1";
const timer = params.get("t");
const room = previewRoom(previewScene(name), {
  viewer,
  offline: list("offline"),
  bots: list("bots"),
  auto: list("auto"),
  spectatorsSeeAll: params.get("all") === "1",
  ...(timer !== null ? { turnRemainingMs: timer === "" ? null : Number(timer) } : {}),
});
// 冒充自己：牌桌按 socket.id 找自己的座位
Object.defineProperty(socket, "id", { value: previewSocketId(viewer), configurable: true });

function Preview() {
  const [theme, toggleTheme] = useTheme();
  return (
    <main className="app-shell ig-game">
      <nav className="ig-preview-nav" style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 0", fontSize: 12 }}>
        {SCENE_LIST.map((scene) => (
          <a key={scene} href={`?s=${scene}&v=${viewer}`} title={SCENES[scene].title} style={{ color: scene === name ? "var(--gold)" : "var(--muted)" }}>{scene}</a>
        ))}
      </nav>
      <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--muted)" }}>{SCENES[name].title}</p>
      <GameBoard
        room={room}
        busy={false}
        error=""
        notice=""
        brand={<span className="brand-name">印加宝藏 · 预览</span>}
        connection={null}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        theme={theme}
        chat={null}
        onCommand={(command) => console.log("command", command)}
        onRematch={() => {}}
        onAuto={() => {}}
        onDissolve={() => {}}
        watchId=""
        onWatch={() => {}}
        onLeave={() => {}}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
