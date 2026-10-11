import { useEffect, useRef } from "react";
import type { GameEvent, GameState, HazardType } from "@incan/game";
import { sfx, synth, useSfxCountdown } from "./gm-sound.js";

/**
 * 印加宝藏的动作音效：对比前后两次对局快照，按这一步的 events 出声。
 * 自己的动作 / 自己分到的宝石 mine=true 响亮，别人的（含观战时所有人的）减半。
 * 第一次拿到快照（进房间、重连、观战刚进来、教程开场）不出声；每个快照只带最近一步的事件，跳了很多步也只响最后一步。
 *
 * 引擎事件 → 声音：
 * - RoundStarted 新一局 → 洗牌 + roundStart；第一次轮到你选 → yourTurn
 * - CardRevealed 翻牌 → flip；宝物 → 宝石叮当（还在神庙里的人每人分到几颗就落几颗，自己在里面就响）；
 *   危险 → 这种危险自己的招牌声（火焰呼呼、木乃伊低吼、落石隆隆、蛇嘶嘶、蜘蛛窸窣）；神器 → sparkle
 * - FirstHazardSkipped 第一张就是危险 → 不另外出声（危险声已经响了）
 * - Decided 有人选好了（不公开选什么）→ 盖下一张牌的 place；Undecided 撤回 → select(false)
 * - TimedOut 超时 → 自己 timeout，别人 pass
 * - ChoicesRevealed 同时亮出 → reveal
 * - PlayersLeft 回营地 → 宝石倒进帐篷 chips + coin，单独带走神器 → sparkle
 * - Collapse 第二张同样的危险，全员逃跑 → 危险声 + 塌方 boom，被困的人 bust（自己被困就响）
 * - RoundEnded 大家都回营地、这局平安结束 → 轻轻两声下行
 * - GameEnded 终局 → gameOver(赢/输)
 * - 再来一局 / 练习局重开（version 变小）→ gameStart
 */

/** 开发时记下响了哪个声音，测试脚本读 window.__sfxLog。 */
function play(name: string, fn: () => void, delay = 0) {
  const run = () => {
    if (import.meta.env.DEV) ((window as unknown as { __sfxLog?: string[] }).__sfxLog ??= []).push(name);
    fn();
  };
  if (delay > 0) window.setTimeout(run, delay);
  else run();
}

/** 五种危险各自的招牌声。 */
const HAZARD_SOUND: Record<HazardType, (v: number) => void> = {
  // 火焰：一阵呼呼往上窜的风声 + 噼啪
  fire(v) {
    synth.noise({ duration: 0.6, volume: 0.22 * v, freq: 400, freqTo: 1800, q: 0.8 });
    for (let i = 0; i < 4; i += 1) synth.noise({ at: 0.1 + i * 0.12 + Math.random() * 0.05, duration: 0.02, volume: 0.18 * v, filter: "highpass", freq: 3000 });
  },
  // 木乃伊：低沉颤抖的哼声
  mummy(v) {
    synth.tone(98, { duration: 0.7, volume: 0.22 * v, type: "sawtooth", glideTo: 82 });
    synth.tone(103, { at: 0.02, duration: 0.7, volume: 0.12 * v, type: "triangle", glideTo: 78 });
    synth.noise({ duration: 0.6, volume: 0.08 * v, filter: "lowpass", freq: 400 });
  },
  // 落石：隆隆 + 几块石头磕下来
  rocks(v) {
    synth.noise({ duration: 0.7, volume: 0.3 * v, filter: "lowpass", freq: 600, freqTo: 120 });
    for (let i = 0; i < 4; i += 1) {
      const at = 0.05 + i * 0.12 + Math.random() * 0.05;
      synth.noise({ at, duration: 0.04, volume: 0.2 * v, freq: 900 * synth.jitter(0.25), q: 2 });
      synth.tone(190 * synth.jitter(0.2), { at, duration: 0.07, volume: 0.1 * v, type: "triangle" });
    }
  },
  // 蛇：长长的嘶嘶声
  snake(v) {
    synth.noise({ duration: 0.75, volume: 0.2 * v, filter: "highpass", freq: 5000, freqTo: 6500 });
    synth.noise({ at: 0.05, duration: 0.6, volume: 0.1 * v, freq: 7000, q: 3 });
  },
  // 蜘蛛：一串细碎的爬动
  spider(v) {
    for (let i = 0; i < 10; i += 1) synth.noise({ at: i * 0.045 + Math.random() * 0.015, duration: 0.015, volume: 0.16 * v, freq: 2600 * synth.jitter(0.3), q: 4 });
    synth.tone(1400, { at: 0.1, duration: 0.3, volume: 0.03 * v, type: "square", glideTo: 1250 });
  },
};

/** 宝石落在一起的叮当（比筹码更亮一点）。 */
function gems(count: number, mine: boolean, at = 0) {
  const v = synth.level(mine);
  const n = Math.min(Math.max(count, 1), 6);
  for (let i = 0; i < n; i += 1) {
    const p = synth.jitter(0.12);
    synth.tone(2350 * p, { at: at + i * 0.07, duration: 0.12, volume: 0.12 * v, type: "triangle" });
    synth.tone(3520 * p, { at: at + i * 0.07 + 0.005, duration: 0.08, volume: 0.07 * v });
    synth.noise({ at: at + i * 0.07, duration: 0.02, volume: 0.12 * v, filter: "highpass", freq: 4000 });
  }
}

type Of<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

export function useGameSfx(game: GameState | undefined, selfId: string) {
  const prev = useRef<GameState | undefined>(undefined);

  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before || !game || before.version === game.version) return;

    if (game.version < before.version) {
      play("gameStart", () => sfx.gameStart());
      return;
    }

    const events = game.events;
    const find = <T extends GameEvent["type"]>(type: T) => events.find((event): event is Of<T> => event.type === type);
    const isMine = (playerId: string) => playerId !== "" && playerId === selfId;
    const meIn = !!selfId && !!game.players.find((player) => player.id === selfId)?.inTemple;
    let at = 0;

    const timedOut = find("TimedOut");
    if (timedOut) {
      const mine = timedOut.players.includes(selfId);
      play(mine ? "timeout" : "pass", () => (mine ? sfx.timeout() : sfx.pass(false)));
      at = 300;
    }

    if (find("RoundStarted")) {
      play("shuffle", () => sfx.shuffle(), at);
      play("roundStart", () => sfx.roundStart(), at + 350);
      at += 700;
    }

    for (const event of events) {
      if (event.type === "Decided") play("place", () => sfx.place(isMine(event.player)), at);
      else if (event.type === "Undecided") play("select", () => sfx.select(false), at);
    }

    const revealed = find("ChoicesRevealed");
    if (revealed) {
      play("reveal", () => sfx.reveal(revealed.stay.includes(selfId) || revealed.leave.includes(selfId)), at + 150);
      at += 550;
    }

    const left = find("PlayersLeft");
    if (left) {
      const mine = left.players.includes(selfId);
      play("chips", () => sfx.chips(Math.min(left.carried + left.share, 6), mine), at);
      if (left.carried + left.share > 0) play("coin", () => sfx.coin(mine), at + 450);
      if (left.artifacts.length > 0) play("sparkle", () => sfx.sparkle(mine), at + 650);
      at += 700;
    }

    const card = find("CardRevealed");
    if (card) {
      play("flip", () => sfx.flip(meIn), at);
      const c = card.card;
      if (c.kind === "treasure") {
        if (card.share > 0) play("gems", () => gems(card.share, meIn), at + 220);
        else play("gems", () => gems(1, false), at + 220);
      } else if (c.kind === "hazard") {
        play(`hazard:${c.hazard}`, () => HAZARD_SOUND[c.hazard](synth.level(meIn || !card.first)), at + 150);
      } else play("sparkle", () => sfx.sparkle(meIn), at + 200);
      at += 650;
    }

    const collapse = find("Collapse");
    if (collapse) {
      const caughtMe = collapse.caught.includes(selfId);
      play("boom", () => sfx.boom(true), at + 100);
      if (collapse.caught.length > 0) play("bust", () => sfx.bust(caughtMe), at + 650);
      at += 1100;
    }

    // 大家都回营地，这一局平安结束：轻轻的两声下行（塌方的已经响过轰隆）
    const roundEnded = find("RoundEnded");
    if (roundEnded && roundEnded.result.reason === "allLeft") {
      play("roundEnd", () => {
        synth.tone(784, { at: 0, duration: 0.18, volume: 0.1, type: "triangle" });
        synth.tone(587, { at: 0.14, duration: 0.3, volume: 0.1, type: "triangle" });
      }, at);
      at += 400;
    }

    const ended = find("GameEnded");
    if (ended) {
      play("gameOver", () => sfx.gameOver(ended.result.winners.includes(selfId)), at + 500);
      return;
    }

    // 每局第一次轮到你选：提示一下（之后每翻一张牌都要选，翻牌声就是提示）
    const firstDecide = game.phase === "decide" && !!card && (card.index === 0 || (card.index === 1 && game.path[0]?.kind === "hazard"));
    const me = game.players.find((player) => player.id === selfId);
    if (firstDecide && me?.inTemple && !me.decided) play("yourTurn", () => sfx.yourTurn(), at + 300);
  }, [game?.version]);
}

/** 自己要做决定的最后 5 秒每秒一声（gm-sound 的 useSfxCountdown）；开发时也记进 __sfxLog。 */
export function useCountdownSfx(isMyTurn: boolean, secondsLeft: number | null | undefined) {
  useSfxCountdown(isMyTurn, secondsLeft);
  useEffect(() => {
    if (import.meta.env.DEV && isMyTurn && secondsLeft != null && secondsLeft >= 1 && secondsLeft <= 5) {
      ((window as unknown as { __sfxLog?: string[] }).__sfxLog ??= []).push("countdown");
    }
  }, [isMyTurn, secondsLeft]);
}
