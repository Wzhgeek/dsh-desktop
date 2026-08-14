# dsh-desktop

DeepSeek Harness 的桌面端应用：把现有的 Web GUI 装进一个 Electron 原生窗口。

它不重写前端——`src/boot.ts` 在 Electron 主进程内 boot 一棵 `web` profile 插件树（与 `dsh web` 共享 Harness home，会话与设置互通），让操作系统分配空闲端口，Electron 窗口加载 `http://127.0.0.1:<port>`。页面来源与请求 Host 同源，现有浏览器信任围栏原样放行，前端一行未改。

## 运行

前置：Node `^22.19 || >=24`、pnpm、以及 `DEEPSEEK_API_KEY`（写入根 `.env`）。

```sh
pnpm install
pnpm build
pnpm start
```

## 脚本

| 命令 | 作用 |
|---|---|
| `pnpm build` | 编译 `src/` 到 `dist/`（tsc） |
| `pnpm start` | 启动 Electron 窗口 |
| `pnpm dev` | 编译后启动 |
| `pnpm smoke` | 无 GUI 冒烟：boot 树、请求 SPA 首页、销毁 |
| `pnpm render-smoke` | Electron 渲染冒烟：offscreen 加载 SPA 并校验 `window.__DSH_BOOT__` |

## 结构

- `src/boot.ts` — 进程内 boot `web` profile（复用 `@deepseek-ai/dsh-app-boot` 的 `boot`/`loadProfile`），返回 loopback URL
- `src/main.ts` — Electron 主进程：boot 树、创建窗口、关闭时 dispose 整棵树
- `src/smoke.ts` / `src/render-smoke.ts` — 两层冒烟验证

## 已知限制与后续

- 目录选择器暂用现有系统后端（macOS osascript），后续替换为 Electron `dialog.showOpenDialog`
- 无 token 鉴权，风险模型与 `dsh web` 一致（绑定回环 + 同源检查）；后续可加本地 token 握手
- 尚未配置 electron-builder 打包分发、应用图标与自动更新
- 前端依赖 npm 包 `@deepseek-ai/dsh-web-frontend` 发布的 dist；桌面打包时需随应用携带

## 协议

MIT。基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT），桌面端仅新增 Electron 壳层。
