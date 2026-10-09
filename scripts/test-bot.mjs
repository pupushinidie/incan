// 本地测试用的陪玩机器人（先 npm run dev，或者 npm run build:game 后单独起服务器）。
//   node scripts/test-bot.mjs host [人数] [机器人数]  → 机器人建房、拉够机器人，等真人加入凑满后自动开局
//   node scripts/test-bot.mjs join <房间码> [昵称]   → 以一个机器人身份加入别人的房间
//   node scripts/test-bot.mjs solo [人数]            → 不等真人：几个机器人自己打完一整局（自检用），打完退出
// 机器人要做决定时（在神庙里、这一张还没决定）按 BOT_LEAVE 的概率选离开，否则继续；BOT_SMART=1 时用人机的走法。
// 每次收到更新、每次行动的回执之后都按最新状态再看一遍（不会漏掉，也不会对旧状态做决定）。
// 环境变量：BOT_DELAY_MS 每步思考时间（默认 800）；BOT_IDLE=1 只挂着不动（等超时）；BOT_LEAVE 离开概率（默认 0.25）；
// INCAN_NO_ARTIFACTS=1 建房时开「无神器」；SERVER_URL（默认 http://localhost:3019）、SOCKET_PATH（线上子路径 /incan/socket.io）。
import { io } from "socket.io-client";
import { botCommand, cardLabel, legalActions } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 3019}`;
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 800);
const IDLE = process.env.BOT_IDLE === "1";
const SMART = process.env.BOT_SMART === "1";
const LEAVE = Number(process.env.BOT_LEAVE ?? 0.25);
const NAMES = ["火把", "绳索", "罗盘", "水壶", "铁铲", "地图", "背包", "帽子"];
const OPTIONS = { noArtifacts: process.env.INCAN_NO_ARTIFACTS === "1" };

let finishedBots = 0;

function bot(name, { onRoom, exitWhenDone = true } = {}) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  let latest = null;
  let acting = false;
  let done = false;
  const seat = () => latest?.members.find((member) => member.id === socket.id)?.playerId;
  const tick = async () => {
    const game = latest?.game;
    if (!game || IDLE || acting || game.phase !== "decide") return;
    const me = game.players.find((player) => player.id === seat());
    if (!me?.inTemple || me.decided) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY));
    try {
      const fresh = latest.game;
      const mine = fresh?.players.find((player) => player.id === seat());
      if (!fresh || fresh.phase !== "decide" || fresh.turn !== game.turn || !mine?.inTemple || mine.decided) return;
      const command = SMART
        ? botCommand(fresh, seat())
        : legalActions(fresh, seat()).find((action) => action.type === "decide" && action.choice === (Math.random() < LEAVE ? "leave" : "stay"));
      if (!command) return;
      const result = await emit("game:command", command);
      if (!result.ok) console.log(name, "行动失败", result.error);
      else latest = result.data;
    } finally {
      acting = false;
      void tick();
    }
  };
  socket.on("room:updated", (room) => {
    latest = room;
    onRoom?.(room, socket);
    const game = room.game;
    if (game?.phase === "gameOver" && !done) {
      done = true;
      const nameOf = (id) => game.players.find((player) => player.id === id)?.name ?? id;
      const scores = game.finalResult.scores.map((line) => `${nameOf(line.player)} ${line.total}（宝石 ${line.gems} + 神器 ${line.artifactPoints}）`).join("，");
      console.log(name, "游戏结束：", scores, "胜者", game.finalResult.winners.map(nameOf).join("、"));
      finishedBots += 1;
      if (exitWhenDone) setTimeout(() => process.exit(0), 300);
      return;
    }
    if (game && game.events.some((event) => event.type === "CardRevealed") && name === NAMES[0]) {
      const card = game.path.at(-1);
      console.log(`  第 ${game.round} 局 第 ${game.path.length} 张：${card ? cardLabel(card) : ""}${game.phase === "roundEnd" ? "（塌方）" : ""}`);
    }
    void tick();
  });
  socket.on("room:closed", ({ reason }) => {
    console.log(name, "房间关闭：", reason);
    process.exit(0);
  });
  socket.on("connect_error", (error) => {
    console.log(name, "连不上服务器", URL, error.message);
    process.exit(1);
  });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const name = arg2 ?? NAMES[1];
  const { socket, emit } = bot(name);
  socket.on("connect", async () => {
    const result = await emit("room:join", { name, code: arg1 });
    console.log("加入", result.ok ? "成功" : result.error);
    if (!result.ok) process.exit(1);
  });
} else {
  const solo = mode === "solo";
  const capacity = Number(arg1 ?? 4);
  const bots = solo ? capacity : Number(arg2 ?? capacity - 1);
  let started = false;
  const host = bot(NAMES[0], {
    exitWhenDone: true,
    onRoom: async (room) => {
      if (!started && room.status === "waiting" && room.members.length === capacity) {
        started = true;
        const result = await host.emit("room:start");
        console.log("开局", result.ok ? "" : result.error);
      }
    },
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity, options: OPTIONS });
    if (!created.ok) {
      console.log(created.error);
      process.exit(1);
    }
    console.log("房间码", created.data.code, solo ? "（机器人自己打）" : `（等真人加入，还差 ${capacity - bots} 人）`);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index];
      const other = bot(name, { exitWhenDone: false });
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
