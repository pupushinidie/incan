/**
 * 印加宝藏的新手教程：在浏览器里按剧本（packages/game/src/tutorial.ts）走前两局，
 * 牌桌就是真正对局的 GameBoard，咕噜嘎的对话框叠在上面；剧本走完接着把这局打完（练习局），两个咕噜交给人机。
 * 不连服务器，不占房间；首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 *
 * 这款是同时决定：练习局里先轮到还没决定的咕噜，再等你；你决定以后在最后一个人决定之前都能改或撤回（canAct）。
 * 翻牌、亮出、局末这些自动阶段按服务器同样的停顿（config.pauseMs）推进。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AUTO_ACTOR,
  applyTutorialMove,
  autoPauseMs,
  botCommand,
  createPracticeGame,
  createTutorialGame,
  DEFAULT_ROOM_ACCESS,
  redactGameForViewer,
  sameMove,
  selfCanAct,
  TUTORIAL_BOTS,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type TutorialMove,
  type TutorialStep,
} from "@incan/game";
import GameBoard from "./GameBoard.js";
import type { Theme } from "./theme.js";
import { Coach, isTouchDevice, StepPips, type CoachView } from "./tutorial/Coach.js";
import { writeTutorial } from "./tutorial/storage.js";
import { useTutorial } from "./tutorial/useTutorial.js";
import { GAME_ID } from "./tutorialGame.js";

const SELF_MEMBER = "tutorial-self";
const TUTORIAL_CODE = "GULU01";

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/** 每一课（带 lesson 的步骤）从第几步开始。 */
const LESSONS = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 这一步翻牌、亮出、宝石飞进帐篷的动画大概多长（毫秒）：动画放着的时候咕噜嘎先不开口，免得对话框挡住飞行。 */
function animationMs(game: GameState): number {
  let ms = 0;
  for (const event of game.events) {
    if (event.type === "CardRevealed") ms = Math.max(ms, 900);
    if (event.type === "ChoicesRevealed") ms = Math.max(ms, 1300);
    if (event.type === "PlayersLeft") ms = Math.max(ms, 1500);
    if (event.type === "Collapse") ms = Math.max(ms, 1500);
    if (event.type === "FirstHazardSkipped") ms = Math.max(ms, 1000);
  }
  return ms;
}

/** 局面换了（version 变了）以后，按这一步的动画长度先等一会儿再显示对话框。 */
function useAnimationHold(game: GameState): boolean {
  const [until, setUntil] = useState(0);
  const [, setTick] = useState(0);
  const seen = useRef(game.version);
  useEffect(() => {
    if (game.version === seen.current) return;
    seen.current = game.version;
    if (reducedMotion()) return;
    const ms = animationMs(game);
    if (ms > 0) setUntil(performance.now() + ms);
  }, [game.version]);
  useEffect(() => {
    const left = until - performance.now();
    if (left <= 0) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), left + 20);
    return () => window.clearTimeout(timer);
  }, [until]);
  return performance.now() < until;
}

export default function TutorialMode({ name, brand, themeToggle, theme, waitingRoom, onExit }: {
  /** 首页填过的昵称；没填叫「新玩家」。 */
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  theme: Theme;
  /** 从等候房间点进来的：那个房间的房间码。 */
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";

  const tutorial = useTutorial<GameState, TutorialMove, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName, randomSeed()),
    restart: () => createPracticeGame(selfName, randomSeed()),
    apply: (state, _playerId, move) => applyTutorialMove(state, move),
    same: sameMove,
    actor: (state) => tutorialActor(state),
    canAct: (state) => selfCanAct(state),
    bot: (state, playerId) => {
      if (playerId === AUTO_ACTOR) return { player: "", command: { type: "advance" } };
      const command = botCommand(redactGameForViewer(state, playerId), playerId);
      return command ? { player: playerId, command } : null;
    },
    // 自动阶段照服务器的停顿；咕噜一个接一个决定，留点时间让人看见帐篷上的沙漏变成扣着的牌
    botDelay: (state) => (tutorialActor(state) === AUTO_ACTOR ? autoPauseMs(state) : 700 + animationMs(state)),
    watchDelay: (move) => (move.command.type === "advance" ? 1900 : 900),
  });
  const { game, step, index, practice, flash } = tutorial;
  const holding = useAnimationHold(game);

  // 走到最后一步就算学完（之后首页不再邀请）
  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  const members = useMemo<LobbyMember[]>(() => [
    { id: SELF_MEMBER, playerId: TUTORIAL_SELF, name: selfName, isHost: false, connected: true },
    ...TUTORIAL_BOTS.map((one) => ({ id: `tutorial-${one.id}`, playerId: one.id, name: one.name, isHost: false, connected: true, bot: true })),
  ], [selfName]);
  const room = useMemo<LobbyRoomSnapshot>(() => ({
    code: TUTORIAL_CODE,
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    options: { noArtifacts: false },
    capacity: 3,
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: redactGameForViewer(game, TUTORIAL_SELF),
  }), [game, members]);

  let view: CoachView | null = null;
  if (step && !holding) {
    const note = isTouchDevice() && step.noteTouch ? step.noteTouch : step.note;
    const finale = step.kind === "info" && step.finale === true;
    const lessonNow = Math.max(0, LESSONS.filter(({ at }) => at <= index).length - 1);
    view = {
      key: step.id,
      say: step.say,
      ...(note ? { note } : {}),
      ...(flash ? { flash } : {}),
      anchor: step.anchor ?? null,
      focus: step.kind !== "watch",
      face: flash ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={lessonNow} total={LESSONS.length} />
          {!finale && <button className="tut-link" type="button" data-tutorial="skip" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" ? null : finale ? (
        <>
          <button className="quiet-button" type="button" data-tutorial="end" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" data-tutorial="practice" onClick={tutorial.startPractice}>和人机打完这局</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" data-tutorial="next" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }

  const onCommand = (command: GameCommand) => tutorial.onCommand({ player: TUTORIAL_SELF, command });

  // 剧本进行中和练习局的侧栏挤法不一样（见 incan.css 的 .tut-script / .tut-practice）
  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <GameBoard
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={
          <>
            <span className="connection-status online"><span className="connection-dot" />{practice ? "练习局" : "新手教程"}</span>
            <button className="quiet-button" type="button" data-tutorial="exit" onClick={practice ? onExit : leave}>退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        theme={theme}
        chat={<Checklist index={index} practice={practice} waitingRoom={waitingRoom} />}
        onCommand={onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={TUTORIAL_SELF}
        onWatch={() => undefined}
        onLeave={onExit}
        selfMemberId={SELF_MEMBER}
        mode={practice ? "practice" : "tutorial"}
        finalActions={
          <>
            <button className="quiet-button" type="button" data-tutorial="end" onClick={onExit}>结束教程</button>
            <button className="primary-button" type="button" data-tutorial="again" onClick={tutorial.newPractice}>再练一局</button>
          </>
        }
      />
      {view && <Coach view={view} />}
    </div>
  );
}

/** 侧栏（真实对局里是聊天）：剧本进行中列出这次学哪几样；练习局只留一句话。 */
function Checklist({ index, practice, waitingRoom }: { index: number; practice: boolean; waitingRoom: string | undefined }) {
  const done = LESSONS.filter((_, order) => (LESSONS[order + 1]?.at ?? TUTORIAL_STEPS.length) <= index).length;
  return (
    <section className="ig-panel tut-checklist" aria-label="新手教程进度">
      {practice ? (
        <>
          <h3>练习局 <small>和两个咕噜打完 5 局</small></h3>
          <p>拿不准就点「提示」（键盘 H），咕噜嘎告诉你它会怎么选。</p>
        </>
      ) : (
        <>
          <h3>新手教程 <small>{done}/{LESSONS.length}</small></h3>
          <ul>
            {LESSONS.map(({ step, at }, order) => {
              const next = LESSONS[order + 1]?.at ?? TUTORIAL_STEPS.length;
              const state = next <= index ? "done" : at <= index ? "now" : "";
              return (
                <li key={step.id} className={state}>
                  <i aria-hidden="true">{state === "done" ? "✓" : state === "now" ? "▶" : "·"}</i>
                  {step.lesson}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waitingRoom && <p>你还在房间 {waitingRoom} 里，房主一开局就自动回到牌桌。</p>}
    </section>
  );
}
