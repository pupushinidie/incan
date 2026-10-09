// 抓包脚本：连上真实服务器（先 npm run dev），两个间谍玩家 A、B 加一个观战的人进同一个房间打一整局，
// 记下服务器发给每个连接的每一条 room:updated（连原始帧），检查：
//   - 发给 B 的数据里没有 A 的帐篷宝石数（A 自己收到的那份里有，用来对照）、没有牌堆顺序、种子、随机数状态、动作序列；
//   - 决定中 B 收到的 A 的选择是 null（A 已经决定时也是），只有「已决定」；
//   - 观战的人（没开「观战看帐篷」）谁的帐篷都看不到；首页列表对局中不给分数。
// 用法：node scripts/spy.mjs [人数，默认 3：A、B + 人机]；SERVER_URL / SOCKET_PATH 同陪玩脚本。全部通过退出码 0，否则 1。
import { io } from "socket.io-client";

const URL = process.env.SERVER_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 3019}`;
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const capacity = Number(process.argv[2] ?? 3);
const problems = [];
const problem = (message) => {
  if (problems.length < 20) problems.push(message);
};

function spy(label) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  const capture = { label, socket, rooms: [], raw: [], lobbies: [] };
  socket.on("room:updated", (room) => capture.rooms.push(room));
  socket.on("lobby:updated", (rooms) => capture.lobbies.push(rooms));
  socket.on("connect", () => socket.io.engine.on("packet", (packet) => typeof packet.data === "string" && capture.raw.push(packet.data)));
  capture.emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  capture.ready = new Promise((resolve) => socket.once("connect", resolve));
  return capture;
}

const a = spy("A");
const b = spy("B");
const watcher = spy("观战");
const outsider = spy("首页");
await Promise.all([a.ready, b.ready, watcher.ready, outsider.ready]);
const nameA = `间谍A${Date.now() % 10000}`;
const created = await a.emit("room:create", { name: nameA, capacity });
if (!created.ok) {
  console.log("建房失败", created.error);
  process.exit(1);
}
const code = created.data.code;
console.log("房间码", code);
if (!(await b.emit("room:join", { name: `间谍B${Date.now() % 10000}`, code })).ok) throw new Error("B 加入失败");
if (!(await watcher.emit("room:join", { name: `观众${Date.now() % 10000}`, code, spectate: true })).ok) throw new Error("观战加入失败");
for (let seat = 2; seat < capacity; seat += 1) await a.emit("room:add-bot");
const started = await a.emit("room:start");
if (!started.ok) throw new Error(`开局失败：${started.error}`);

// A 早点离开（帐篷里有宝石），B 多挖几张；B 每次都晚一点决定，好看到「A 已决定、B 还没决定」的中间状态
const seatOf = (capture, room) => room.members.find((member) => member.id === capture.socket.id)?.playerId;
for (const [capture, leaveAfter, wait] of [[a, 2, 50], [b, 4, 400]]) {
  capture.socket.on("room:updated", (room) => {
    const game = room.game;
    const mine = game?.players.find((player) => player.id === seatOf(capture, room));
    if (!game || game.phase !== "decide" || !mine?.inTemple || mine.decided) return;
    const turn = game.turn;
    setTimeout(() => capture.socket.emit("game:command", { type: "decide", choice: game.path.length >= leaveAfter ? "leave" : "stay", turn }, () => {}), wait);
  });
}
let lobbyDuring = null;
const finished = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("5 分钟内没打完")), 300_000);
  a.socket.on("room:updated", async (room) => {
    if (!lobbyDuring && room.game?.round === 3) lobbyDuring = await outsider.emit("lobby:get");
    if (room.game?.phase === "gameOver") {
      clearTimeout(timer);
      resolve(room);
    }
  });
});

const seatA = seatOf(a, a.rooms.at(-1));
const seatB = seatOf(b, b.rooms.at(-1));
const tentsOfA = new Set(a.rooms.map((room) => room.game?.players.find((player) => player.id === seatA)?.tent).filter((tent) => typeof tent === "number" && tent > 0));
let aDecidedSeenByB = 0;
for (const capture of [a, b, watcher]) {
  for (const room of capture.rooms) {
    const game = room.game;
    if (!game) continue;
    if (!Array.isArray(game.deck) || game.deck.length !== 0) problem(`${capture.label} 收到了牌堆`);
    for (const key of ["seed", "rngState", "log"]) if (key in game) problem(`${capture.label} 收到了 ${key}`);
    const self = capture === watcher ? "" : seatOf(capture, room);
    for (const player of game.players) {
      if (player.id === self) continue;
      if (game.phase !== "gameOver" && player.tent !== null) problem(`${capture.label} 看到了 ${player.name} 的帐篷：${player.tent}`);
      if (game.phase === "decide" && player.choice !== null) problem(`${capture.label} 在决定中看到了 ${player.name} 的选择`);
      if (capture === b && player.id === seatA && game.phase === "decide" && player.decided) aDecidedSeenByB += 1;
    }
  }
  for (const frame of capture.raw) {
    if (/"(seed|rngState|log)"/.test(frame)) problem(`${capture.label} 的原始帧里有种子 / 随机数状态 / 动作序列`);
    if (/"deck":\[\{/.test(frame)) problem(`${capture.label} 的原始帧里有牌堆`);
  }
}
// B 收到的原始帧里，A 的那一条玩家记录不该带帐篷数（对局中）
for (const frame of b.raw) {
  const match = frame.match(new RegExp(`"id":"${seatA}"[^}]*"tent":(\\d+)`));
  if (match && !frame.includes('"phase":"gameOver"')) problem(`B 的原始帧里有 A 的帐篷 ${match[1]}`);
}
if (lobbyDuring?.ok) {
  for (const summary of lobbyDuring.data) {
    if (summary.status === "playing" && summary.players.some((player) => player.score !== undefined)) problem("首页列表对局中给了分数");
  }
}
if (tentsOfA.size === 0) problem("A 的帐篷一直是 0，这次抓包没测到东西（换个种子再跑）");
if (aDecidedSeenByB === 0) problem("没抓到「A 已决定、B 还没决定」的中间状态");

const finalScores = finished.game.finalResult.scores.map((line) => `${line.player}:${line.total}`).join(" ");
console.log(`A 收到 ${a.rooms.length} 条、B 收到 ${b.rooms.length} 条、观战 ${watcher.rooms.length} 条房间更新；A 自己看到的帐篷数 ${[...tentsOfA].join("/")}；B 看到「A 已决定」${aDecidedSeenByB} 次`);
console.log("终局", finalScores);
if (problems.length) {
  console.log("发现问题：");
  for (const message of problems) console.log(" -", message);
  process.exit(1);
}
console.log("抓包通过：B 和观战的人都拿不到 A 的帐篷、决定中的选择、牌堆、种子；首页列表对局中不给分数。");
for (const capture of [a, b, watcher, outsider]) capture.socket.disconnect();
process.exit(0);
