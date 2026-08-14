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

- `src/boot.ts` — 进程内 boot `web` profile（复用 `@deepseek-ai/dsh-app-boot` 的 `boot`/`loadProfile`），返回 loopback URL；并挂载桌面 host 插件
- `src/host/*` — 桌面 host 插件（cordis 函数插件，boot prepare 时挂载）：`desktop-host.ts`（ping + index tap）、`appearance-host.ts`、`usage-host.ts`、`git-host.ts`
- `src/main.ts` — Electron 主进程：boot 树、创建窗口、关闭时 dispose 整棵树
- `plugins/client` — 桌面 client 插件包 `@dsh-desktop/client`（browser bundle 由 client-modules 加载），注册设置页/会话头/Git 面板到 UI 插槽
- `src/smoke.ts` / `src/render-smoke.ts` — 两层冒烟验证

## 桌面扩展功能（overlay 插件，不动上游包）

| 功能 | 落点 | 说明 |
|---|---|---|
| 外观个性化 | 设置页「Appearance」+ host CSS 注入 | 字体族/字号/accent 色/代码主题，偏好持久化到 `$DSH_HOME/dsh-desktop-appearance.json`，经 `tapIndex` 注入 CSS 变量，重启生效 |
| 用量/成本 | 会话头显示 `X in · Y out · $估算` | 读 `tokenUsage` 投影 + host 定价表（DeepSeek 率卡），USD 估算 |
| Git 面板 | `conversation.view` 的「Git」页签 | status/diff 展示 + 提交（`git add -A && git commit`），走 host `child_process`，参数化无注入 |

## 已知限制与后续

- Git 面板操作根目录按 `DSH_DESKTOP_GIT_ROOT` 环境变量 → 首个注册的 Harness workspace → `process.cwd()` 解析；尚未提供目录选择器，MVP 不跟踪当前会话所在 workspace
- 外观偏好在设置页保存后**重启生效**（tapIndex 在 index 渲染时注入）；已加载页面不热更新
- 用量定价为内置常量表（deepseek-chat / deepseek-reasoner），非实时抓取
- 目录选择器暂用现有系统后端（macOS osascript），后续替换为 Electron `dialog.showOpenDialog`
- 无 token 鉴权，风险模型与 `dsh web` 一致（绑定回环 + 同源检查）；后续可加本地 token 握手
- 尚未配置 electron-builder 打包分发、应用图标与自动更新
- 前端依赖 npm 包 `@deepseek-ai/dsh-web-frontend` 发布的 dist；桌面打包时需随应用携带

## 协议

MIT。基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT），桌面端仅新增 Electron 壳层。
