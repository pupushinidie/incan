import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  buildScene,
  type AckResponse,
  type ClientToServerEvents,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type ServerToClientEvents,
} from "@incan/game";

// 抓包：每个连接收到的每一条 room:updated（连原始帧一起）都查一遍，有没有不该看到的东西。
process.env.TURN_MS = "400";
process.env.PAUSE_SCALE = "0";
process.env.BOT_DELAY_SCALE = "0";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Capture {
  client: TestSocket;
  rooms: LobbyRoomSnapshot[];
  raw: string[];
  lobbies: PublicRoomSummary[][];
}

const captures: Capture[] = [];
let serverUrl = "";
let server: typeof import("../src/index.js");

function connect(): Promise<Capture> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    const capture: Capture = { client, rooms: [], raw: [], lobbies: [] };
    captures.push(capture);
    client.on("room:updated", (room) => capture.rooms.push(room));
    client.on("lobby:updated", (rooms) => capture.lobbies.push(rooms));
    client.once("connect", () => {
      client.io.engine.on("packet", (packet: { data?: unknown }) => {
        if (typeof packet.data === "string") capture.raw.push(packet.data);
      });
      resolve(capture);
    });
    client.once("connect_error", reject);
  });
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

function waitFor(capture: Capture, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 20_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const last = capture.rooms.at(-1);
    if (last && test(last)) {
      resolve(last);
      return;
    }
    const timer = setTimeout(() => reject(new Error("等不到想要的状态")), timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      capture.client.off("room:updated", handler);
      resolve(room);
    };
    capture.client.on("room:updated", handler);
  });
}

const seatOf = (capture: Capture, room: LobbyRoomSnapshot) => room.members.find((member) => member.id === capture.client.id)?.playerId ?? "";

describe("抓包：发给每个人的数据里没有别人的帐篷、牌堆顺序、种子、决定中的选择", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve, reject) => {
      server.httpServer.once("error", reject);
      server.httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const capture of captures) capture.client.disconnect();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  it("三个玩家 + 一个观战 + 一个停在首页的连接，打完一整局", async () => {
    const [a, b, c] = [await connect(), await connect(), await connect()];
    const watcher = await connect();
    const outsider = await connect();
    const names = ["探险甲", "探险乙", "探险丙"];
    const created = await call<LobbyRoomSnapshot>((ack) => a.client.emit("room:create", { name: names[0]!, capacity: 3 }, ack));
    if (!created.ok) throw new Error(created.error);
    const code = created.data.code;
    for (const [index, capture] of [b, c].entries()) {
      expect((await call<LobbyRoomSnapshot>((ack) => capture.client.emit("room:join", { name: names[index + 1]!, code }, ack))).ok).toBe(true);
    }
    expect((await call<LobbyRoomSnapshot>((ack) => watcher.client.emit("room:join", { name: "看热闹", code, spectate: true }, ack))).ok).toBe(true);
    expect((await call<LobbyRoomSnapshot>((ack) => a.client.emit("room:start", ack))).ok).toBe(true);
    // 帐篷里先放点宝石，再接着打：甲 23、乙 9（第 2 局）
    server.testHooks.setGame(code, buildScene({ players: names, round: 2, tentsBefore: { p1: 23, p2: 9 }, claimsBefore: [{ player: "p3", artifact: 1 }], path: [7] }));

    // 三个人各自的打法：甲很快离开，乙偶尔离开，丙一直继续（多半被困）
    let decisions = 0;
    const policies: Record<string, (path: number) => "stay" | "leave"> = {
      p1: (path) => (path >= 2 ? "leave" : "stay"),
      p2: (path) => (path >= 4 ? "leave" : "stay"),
      p3: () => "stay",
    };
    for (const capture of [a, b, c]) {
      capture.client.on("room:updated", (room) => {
        const game = room.game;
        const seat = seatOf(capture, room);
        const mine = game?.players.find((player) => player.id === seat);
        if (!game || game.phase !== "decide" || !mine?.inTemple || mine.decided) return;
        decisions += 1;
        // 偶尔慢一点，让别人看到「已决定」的中间状态
        setTimeout(() => capture.client.emit("game:command", { type: "decide", choice: policies[seat]!(game.path.length), turn: game.turn }, () => {}), seat === "p3" ? 30 : 0);
      });
    }
    // 中途房主打开「观战看帐篷」
    await waitFor(a, (room) => room.game?.round === 3);
    expect((await call<void>((ack) => a.client.emit("room:access", { spectatorsSeeAll: true }, ack))).ok).toBe(true);
    const lobbyDuring = await call<PublicRoomSummary[]>((ack) => outsider.client.emit("lobby:get", ack));
    await waitFor(a, (room) => room.game?.phase === "gameOver", 30_000);
    expect(decisions).toBeGreaterThan(5);

    let othersTentHidden = 0;
    let othersChoiceHidden = 0;
    for (const capture of [a, b, c]) {
      for (const room of capture.rooms) {
        const game = room.game;
        if (!game) continue;
        const seat = seatOf(capture, room);
        const record = game as unknown as Record<string, unknown>;
        expect(game.deck).toEqual([]);
        for (const key of ["seed", "rngState", "log"]) expect(record[key]).toBeUndefined();
        for (const player of game.players) {
          if (player.id === seat) {
            expect(typeof player.tent).toBe("number");
            continue;
          }
          if (game.phase !== "gameOver") {
            expect(player.tent).toBeNull();
            othersTentHidden += 1;
          }
          if (game.phase === "decide") {
            expect(player.choice).toBeNull();
            if (player.decided) othersChoiceHidden += 1;
          }
        }
        // 事件里没有选择内容（ChoicesRevealed 只在亮出之后出现）
        if (game.phase === "decide") expect(JSON.stringify(game.events)).not.toMatch(/"(stay|leave)"/);
      }
      // 原始帧：没有种子、随机数状态、动作序列；牌堆永远是空数组
      for (const frame of capture.raw) {
        expect(frame).not.toMatch(/"(seed|rngState|log)"/);
        expect(frame).not.toMatch(/"deck":\[\{/);
      }
    }
    expect(othersTentHidden).toBeGreaterThan(50);
    expect(othersChoiceHidden).toBeGreaterThan(0);

    // 观战：开「观战看帐篷」之前谁的帐篷都看不到；之后看得到帐篷，但决定中的选择照样看不到
    let blind = 0;
    let god = 0;
    for (const room of watcher.rooms) {
      const game = room.game;
      if (!game) continue;
      expect(game.deck).toEqual([]);
      if (game.phase === "gameOver") continue;
      if (room.access.spectatorsSeeAll) {
        expect(game.players.every((player) => typeof player.tent === "number")).toBe(true);
        god += 1;
      } else {
        expect(game.players.every((player) => player.tent === null)).toBe(true);
        blind += 1;
      }
      if (game.phase === "decide") expect(game.players.every((player) => player.choice === null)).toBe(true);
    }
    expect(blind).toBeGreaterThan(0);
    expect(god).toBeGreaterThan(0);
    for (const frame of watcher.raw) expect(frame).not.toMatch(/"(seed|rngState|log)"/);

    // 首页列表：对局中不给分数
    expect(lobbyDuring.ok).toBe(true);
    if (lobbyDuring.ok) {
      const summary = lobbyDuring.data.find((room) => room.players.some((player) => player.name === names[0]));
      expect(summary?.players.every((player) => player.score === undefined)).toBe(true);
    }
    for (const rooms of outsider.lobbies) {
      for (const summary of rooms) {
        if (summary.status === "playing") expect(summary.players.every((player) => player.score === undefined)).toBe(true);
      }
    }
  }, 40_000);
});
