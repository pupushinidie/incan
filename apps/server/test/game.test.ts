import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  buildScene,
  legalActions,
  type AckResponse,
  type ClientToServerEvents,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type ServerToClientEvents,
} from "@incan/game";

// 决定 1.5 秒超时（测倒计时不被别人重置）；自动阶段不停顿；人机立刻行动。服务端在导入时读这些变量。
process.env.TURN_MS = "1500";
process.env.PAUSE_SCALE = "0";
process.env.BOT_DELAY_SCALE = "0";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
let serverUrl = "";
let server: typeof import("../src/index.js");
let nameSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.on("room:updated", (room) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function nick(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 10_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seatOf = (client: TestSocket) => latest.get(client)?.members.find((member) => member.id === client.id)?.playerId ?? "";
const me = (room: LobbyRoomSnapshot, client: TestSocket) => room.game!.players.find((player) => player.id === seatOf(client))!;
const command = (client: TestSocket, cmd: GameCommand) => call<LobbyRoomSnapshot>((ack) => client.emit("game:command", cmd, ack));
const decide = (client: TestSocket, choice: "stay" | "leave") => command(client, { type: "decide", choice, turn: latest.get(client)!.game!.turn });
const lobby = (client: TestSocket) => new Promise<PublicRoomSummary[]>((resolve) => client.emit("lobby:get", (response) => resolve(response.ok ? response.data : [])));

/** 建一个 3 人房（三个真人），返回 [房主, 乙, 丙] 和房间码。 */
async function threeHumans(options?: { noArtifacts: boolean }): Promise<{ players: TestSocket[]; names: string[]; code: string }> {
  const players = [await connect(), await connect(), await connect()];
  const names = [nick("甲"), nick("乙"), nick("丙")];
  const created = await call<LobbyRoomSnapshot>((ack) => players[0]!.emit("room:create", { name: names[0]!, capacity: 3, ...(options ? { options } : {}) }, ack));
  if (!created.ok) throw new Error(created.error);
  const code = created.data.code;
  for (let index = 1; index < 3; index += 1) {
    expect((await call<LobbyRoomSnapshot>((ack) => players[index]!.emit("room:join", { name: names[index]!, code }, ack))).ok).toBe(true);
  }
  return { players, names, code };
}

/** 换上一个指定局面（座位 p1..p3 对应三个人），等三个人都收到。 */
async function setScene(code: string, players: TestSocket[], game: GameState): Promise<void> {
  server.testHooks.setGame(code, game);
  for (const client of players) await updateWhere(client, (room) => room.game?.version === game.version);
}

describe("对局流程", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve, reject) => {
      server.httpServer.once("error", reject);
      server.httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  it("房间人数只能 3–8；不到 3 人开不了局", async () => {
    const host = await connect();
    for (const capacity of [2, 9]) {
      const response = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity } as never, ack));
      expect(response.ok).toBe(false);
    }
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 8 }, ack));
    expect(created.ok && created.data.capacity).toBe(8);
    const guest = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("客"), code: created.ok ? created.data.code : "" }, ack))).ok).toBe(true);
    const start = await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
    expect(start.ok).toBe(false);
    expect(start.ok ? "" : start.error).toContain("3");
  });

  it("建房 → 加入 → 开局 → 继续 / 离开 / 改选 / 撤回 / 单人拿神器 / 超时 → 局末 → 终局 → 再来一局", async () => {
    const { players, names, code } = await threeHumans();
    const [a, b, c] = players as [TestSocket, TestSocket, TestSocket];
    const started = await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack));
    expect(started.ok && started.data.game?.round).toBe(1);
    // 开局：start 阶段服务器自己翻第一张（PAUSE_SCALE=0 立刻翻）
    await updateWhere(a, (room) => (room.game?.path.length ?? 0) >= 1);

    // 换上固定局面：翻出 11（3 人各 3，余 2），接下来是 A1、5、火焰、火焰
    await setScene(code, players, buildScene({ players: names, path: [11], deckTop: ["A1", 5, "fire", "fire"] }));
    let room = latest.get(a)!;
    expect(room.game!.phase).toBe("decide");
    expect(room.turnRemainingMs).toBeGreaterThan(0);
    expect(me(room, a).carried).toBe(3);

    // 决定、改选、撤回：别人只看到「已决定」
    expect((await decide(a, "stay")).ok).toBe(true);
    expect((await decide(b, "leave")).ok).toBe(true);
    const seenByC = await updateWhere(c, (snapshot) => snapshot.game!.players.find((p) => p.id === "p2")!.decided);
    expect(seenByC.game!.players.find((p) => p.id === "p2")!.choice).toBeNull();
    expect((await decide(b, "stay")).ok).toBe(true); // 改选
    expect((await command(c, { type: "undecide" })).ok).toBe(false); // 没决定不能撤回
    expect((await decide(c, "leave")).ok).toBe(true);
    // 最后一个人决定的同一步亮出：c 单独离开，拿走路上余数 2
    room = await updateWhere(c, (snapshot) => snapshot.game!.players.find((p) => p.id === "p3")!.inTemple === false);
    expect(me(room, c).tent).toBe(3 + 2);
    // 撤回已经晚了
    expect((await command(a, { type: "undecide" })).ok).toBe(false);

    // 下一张 A1：a 单独离开拿神器
    room = await updateWhere(a, (snapshot) => snapshot.game!.phase === "decide" && snapshot.game!.path.length === 2);
    expect(room.game!.pathArtifacts).toEqual([1]);
    expect((await decide(a, "leave")).ok).toBe(true);
    expect((await decide(b, "stay")).ok).toBe(true);
    room = await updateWhere(b, (snapshot) => snapshot.game!.players[0]!.artifacts.length === 1);
    expect(room.game!.players[0]!.artifacts[0]).toMatchObject({ artifact: 1, order: 1, value: 5 });
    // b 看不到 a、c 的帐篷，看得到自己的
    expect(room.game!.players[0]!.tent).toBeNull();
    expect(room.game!.players[2]!.tent).toBeNull();
    expect(me(room, b).tent).toBe(0);

    // 下一张 5：只剩 b。离开计时测超时：b 不动，到点按离开处理
    room = await updateWhere(b, (snapshot) => snapshot.game!.phase === "decide" && snapshot.game!.path.length === 3);
    expect(me(room, b).carried).toBe(3 + 5);
    server.testHooks.expireTurn(code);
    room = await updateWhere(b, (snapshot) => snapshot.game!.events.some((event) => event.type === "TimedOut"));
    expect(room.game!.events[0]).toEqual({ type: "TimedOut", players: ["p2"] });
    expect(me(room, b).tent).toBe(8);
    // 全员离开 → 局末 → 第 2 局（PAUSE_SCALE=0 一路推进）
    room = await updateWhere(b, (snapshot) => snapshot.game!.round === 2);
    expect(room.game!.history[0]).toMatchObject({ round: 1, reason: "allLeft" });

    // 对局中首页列表不给分数（帐篷是隐藏信息）
    const during = (await lobby(await connect())).find((summary) => summary.players.some((player) => player.name === names[0]));
    expect(during?.status).toBe("playing");
    expect(during?.round).toBe(2);
    expect(during?.players.every((player) => player.score === undefined)).toBe(true);

    // 剩下 4 局：每次决定都一起离开，打到终局
    const stops = players.map((client) => {
      const handler = (snapshot: LobbyRoomSnapshot) => {
        const game = snapshot.game;
        if (!game || game.phase !== "decide") return;
        const mine = game.players.find((player) => player.id === seatOf(client));
        if (mine?.inTemple && !mine.decided) client.emit("game:command", { type: "decide", choice: "leave", turn: game.turn }, () => {});
      };
      client.on("room:updated", handler);
      handler(latest.get(client)!);
      return () => client.off("room:updated", handler);
    });
    room = await updateWhere(a, (snapshot) => snapshot.game?.phase === "gameOver", 20_000);
    for (const stop of stops) stop();
    expect(room.game!.history).toHaveLength(5);
    expect(room.game!.finalResult!.scores).toHaveLength(3);
    // 终局所有人的帐篷公开
    expect(room.game!.players.every((player) => typeof player.tent === "number")).toBe(true);
    expect(room.rematch).toBeDefined();
    const after = (await lobby(await connect())).find((summary) => summary.players.some((player) => player.name === names[0]));
    expect(after?.status).toBe("finished");
    expect(after?.players.every((player) => typeof player.score === "number")).toBe(true);

    // 再来一局
    for (const client of players) expect((await call<void>((ack) => client.emit("room:rematch", true, ack))).ok).toBe(true);
    room = await updateWhere(a, (snapshot) => !snapshot.rematch && snapshot.game !== undefined && snapshot.game.phase !== "gameOver" && snapshot.game.round === 1);
    expect(room.game!.players.every((player) => player.artifacts.length === 0)).toBe(true);
    expect(me(room, a).tent).toBe(0);
  }, 40_000);

  it("别人决定、改选、撤回不会重置倒计时；到点没决定的人按离开处理，连续 2 次超时转托管", async () => {
    const { players, names, code } = await threeHumans();
    const [a, b, c] = players as [TestSocket, TestSocket, TestSocket];
    expect((await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack))).ok).toBe(true);
    await setScene(code, players, buildScene({ players: names, path: [9, 4], deckTop: [7, 2, 3] }));
    const first = latest.get(a)!.turnRemainingMs!;
    expect(first).toBeGreaterThan(1000);
    await delay(500);
    expect((await decide(b, "stay")).ok).toBe(true);
    expect((await command(b, { type: "undecide" })).ok).toBe(true);
    expect((await decide(b, "stay")).ok).toBe(true);
    const later = (await updateWhere(a, (room) => room.game!.players[1]!.decided)).turnRemainingMs!;
    expect(later).toBeLessThan(first - 300);

    // 到点：a、c 没决定 → 离开；b 继续
    let room = await updateWhere(b, (snapshot) => snapshot.game!.events.some((event) => event.type === "TimedOut"), 5000);
    expect(room.game!.events[0]).toEqual({ type: "TimedOut", players: ["p1", "p3"] });
    expect(room.members.some((member) => member.auto)).toBe(false);
    // 之后 b 每次都马上离开（不超时）；a、c 下一局再超时一次 → 托管（人机代打）
    const keepB = (snapshot: LobbyRoomSnapshot) => {
      const game = snapshot.game;
      const mine = game?.players.find((player) => player.id === "p2");
      if (game?.phase === "decide" && mine?.inTemple && !mine.decided) b.emit("game:command", { type: "decide", choice: "leave", turn: game.turn }, () => {});
    };
    b.on("room:updated", keepB);
    keepB(latest.get(b)!);
    room = await updateWhere(b, (snapshot) => snapshot.members.filter((member) => member.auto).length === 2, 15_000);
    b.off("room:updated", keepB);
    expect(room.members.filter((member) => member.auto).map((member) => member.playerId).sort()).toEqual(["p1", "p3"]);
    // 自己动一下就取消托管
    expect((await call<void>((ack) => a.emit("room:auto", false, ack))).ok).toBe(true);
    await updateWhere(a, (snapshot) => !snapshot.members.find((member) => member.playerId === "p1")!.auto);
    void c;
  }, 30_000);

  it("掉线后用原昵称加房间码回到原座位，帐篷和神器都还在；对局中别的名字、在线的同名都进不来", async () => {
    const { players, names, code } = await threeHumans();
    const [a, b] = players as [TestSocket, TestSocket];
    expect((await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack))).ok).toBe(true);
    await setScene(
      code,
      players,
      buildScene({ players: names, round: 2, claimsBefore: [{ player: "p2", artifact: 1 }], tentsBefore: { p2: 17 }, path: [13] }),
    );
    b.disconnect();
    await updateWhere(a, (room) => room.members.find((member) => member.playerId === "p2")!.connected === false);

    const stranger = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => stranger.emit("room:join", { name: nick("路人"), code }, ack))).ok).toBe(false);
    const impostor = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => impostor.emit("room:join", { name: names[0]!, code }, ack))).ok).toBe(false);

    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name: names[1]!, code }, ack));
    expect(rejoined.ok).toBe(true);
    if (!rejoined.ok) return;
    const seat = rejoined.data.members.find((member) => member.id === back.id)!;
    expect(seat).toMatchObject({ playerId: "p2", connected: true });
    const mine = rejoined.data.game!.players.find((player) => player.id === "p2")!;
    expect(mine.tent).toBeGreaterThanOrEqual(17);
    expect(mine.artifacts).toHaveLength(1);
  }, 20_000);

  it("开房选项「无神器」：只有房主能改、对局中不能改；开了以后牌堆没有神器", async () => {
    const { players } = await threeHumans();
    const [a, b] = players as [TestSocket, TestSocket];
    expect(latest.get(a)!.options).toEqual({ noArtifacts: false });
    expect((await call<void>((ack) => b.emit("room:settings", { noArtifacts: true }, ack))).ok).toBe(false);
    expect((await call<void>((ack) => a.emit("room:settings", { noArtifacts: true }, ack))).ok).toBe(true);
    await updateWhere(b, (room) => room.options.noArtifacts);
    const started = await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack));
    expect(started.ok && started.data.game?.config.noArtifacts).toBe(true);
    expect(started.ok && started.data.game?.deckArtifacts).toBe(0);
    expect((await call<void>((ack) => a.emit("room:settings", { noArtifacts: false }, ack))).ok).toBe(false);

    const solo = await threeHumans({ noArtifacts: true });
    expect(latest.get(solo.players[0]!)!.options.noArtifacts).toBe(true);
  });

  it("legalActions 给出的命令服务器都接受；离开神庙的人、自动阶段的命令都被拒", async () => {
    const { players, names, code } = await threeHumans();
    const [a, b] = players as [TestSocket, TestSocket];
    expect((await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack))).ok).toBe(true);
    await setScene(code, players, buildScene({ players: names, path: [5, "snake"], leftAfter: { p1: 1 }, phase: "decide" }));
    expect((await decide(a, "stay")).ok).toBe(false);
    for (const action of legalActions(latest.get(b)!.game!, "p2")) {
      expect((await command(b, action)).ok).toBe(true);
      await delay(10);
    }
  });
});
