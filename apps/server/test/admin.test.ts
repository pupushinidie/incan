import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type { AckResponse, ClientToServerEvents, LobbyRoomSnapshot, PublicRoomSummary, ServerToClientEvents } from "@incan/game";

// 大厅的管理员页靠 lobby:get 列房间、admin:dissolve 强制关闭（口令从 ADMIN_TOKEN 读，导入前设好）。
const TOKEN = "admin-dissolve-test-token";
process.env.ADMIN_TOKEN = TOKEN;
process.env.PAUSE_SCALE = "0";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let serverUrl = "";
let server: typeof import("../src/index.js");
const clients: TestSocket[] = [];

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.push(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

describe("管理员", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.close();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  it("口令验证；lobby:get 列出对局中的房间；admin:dissolve 关掉房间并通知里面的人", async () => {
    const host = await connect();
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: "管理测试", capacity: 3 }, ack));
    if (!created.ok) throw new Error(created.error);
    for (let seat = 1; seat < 3; seat += 1) expect((await call<void>((ack) => host.emit("room:add-bot", ack))).ok).toBe(true);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);

    const admin = await connect();
    expect((await call<void>((ack) => admin.emit("admin:verify", "wrong", ack))).ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 2100)); // 输错后 2 秒内不让再试
    expect((await call<void>((ack) => admin.emit("admin:verify", TOKEN, ack))).ok).toBe(true);
    const rooms = await call<PublicRoomSummary[]>((ack) => admin.emit("lobby:get", ack));
    const target = rooms.ok ? rooms.data.find((room) => room.players.some((player) => player.name === "管理测试")) : undefined;
    expect(target?.status).toBe("playing");
    expect(target?.players.filter((player) => player.bot)).toHaveLength(2);

    expect((await call<void>((ack) => admin.emit("admin:dissolve", { roomId: target!.id, token: "wrong" }, ack))).ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const closed = new Promise<string>((resolve) => host.once("room:closed", ({ reason }) => resolve(reason)));
    expect((await call<void>((ack) => admin.emit("admin:dissolve", { roomId: target!.id, token: TOKEN }, ack))).ok).toBe(true);
    expect(await closed).toContain("管理员");
    const after = await call<PublicRoomSummary[]>((ack) => admin.emit("lobby:get", ack));
    expect(after.ok && after.data.some((room) => room.id === target!.id)).toBe(false);
  }, 15_000);
});
