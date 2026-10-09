import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";

// 端口从环境变量读，默认是分配给印加宝藏的 5192 / 3019；别人要另起一套服务时改 WEB_PORT / SERVER_PORT 就不会撞。
const WEB_PORT = Number(process.env.WEB_PORT ?? 5192);
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3019);
const SERVER = `http://localhost:${SERVER_PORT}`;

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/incan/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), dayTheme(palette)],
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      "/socket.io": { target: SERVER, ws: true },
      "/health": SERVER
    }
  }
});
