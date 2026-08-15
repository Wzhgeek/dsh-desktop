# Dsh Desktop

DeepSeek Harness 的桌面客户端。它在 Electron 主进程中启动完整的 `web` profile，并通过桌面 overlay 插件补齐原生窗口、Git、用量统计、搜索和会话效率功能。

应用与 `dsh web` 共享 Harness home，因此工作区、会话、模型凭据和用户设置互通。内置服务只监听系统分配的 `127.0.0.1` 随机端口，Electron 窗口加载同源页面，继续使用 Harness 原有的浏览器信任边界。

## 运行

前置：Node `^22.19 || >=24`、pnpm。

API key 可以直接在应用内配置，无需 `.env`：启动后进入「设置 → 模型 → DeepSeek」，粘贴 API key 并应用。首次运行会自动打开模型配置引导；凭据由 Harness 的只写凭据存储管理。也可在根目录 `.env` 中设置 `DEEPSEEK_API_KEY`。

首次安装（含 client 插件包的构建工具）：

```sh
pnpm install
pnpm --dir plugins/client install
pnpm build
pnpm start
```

日常启动（构建产物已在时）：

```sh
pnpm start
```

开发或验证源码改动时使用 `pnpm dev`，它会先重建 host 和 client；`pnpm start` 只运行现有 `dist/` / `plugins/client/lib/` 产物。

## 脚本

| 命令 | 作用 |
|---|---|
| `pnpm build` | 构建 client overlay，并编译 `src/` 到 `dist/` |
| `pnpm start` | 启动 Electron 窗口 |
| `pnpm dev` | 编译后启动 |
| `pnpm test` | 运行桌面 host 与 client 单元测试 |
| `pnpm smoke` | 无 GUI 集成冒烟：boot 插件树并验证主要 API 和页面入口 |
| `pnpm render-smoke` | Electron 渲染冒烟：offscreen 加载 SPA 并校验 `window.__DSH_BOOT__` |
| `pnpm runtime-smoke` | 校验 sandbox preload、桌面命令和主题 IPC |
| `pnpm pack:dir` | 构建当前平台的未安装目录，用于本机打包检查 |
| `pnpm dist:mac` | 生成 macOS DMG/ZIP（Intel 与 Apple Silicon） |
| `pnpm dist:win` | 生成 Windows x64 NSIS 安装程序 |
| `pnpm dist:linux` | 生成 Linux x64 AppImage 与 DEB |

## 功能

### 桌面集成

- 系统托盘：关闭窗口时隐藏到托盘，托盘菜单可重新显示或彻底退出。
- 原生通知：会话完成和预算达到阈值时发送系统通知；点击任务通知可恢复对应会话。
- 应用快捷键：`Cmd/Ctrl+K` 打开命令面板，`Cmd/Ctrl+N` 新建会话，`Cmd/Ctrl+,` 打开设置。
- 跟随系统深浅色、恢复上次活跃会话、原生目录选择器，以及 Dsh Desktop 应用名称和图标。
- 在「设置 → 通用设置」检查、下载并安装新版本；正式安装包从 GitHub Releases 获取更新元数据。

### 会话与搜索

- `Cmd/Ctrl+K` 统一搜索命令、会话标题、历史消息全文和当前工作区文件。
- 在输入框键入 `@` 搜索并插入工作区文件引用。
- 对话中的文件路径和文件搜索结果可以直接打开；默认使用系统文件管理器，也可在设置中选择 VS Code、Cursor 或终端。
- 会话头提供任务概览，集中展示工作区、Git 变更/分支、子智能体、后台进程、浏览器和附件来源。
- 对话左侧的轮次轨道支持快速定位，并在悬停时显示该轮摘要。
- 会话可导出为 Markdown、纯文本或包含子会话与附件的 Session 日志 ZIP。
- 定时任务面板支持延时、指定时间和周期运行，并可查看或删除已有计划。
- 会话检查点可从任一已完成轮次创建新分支；原会话保持不变。

### Git

- 两栏布局固定展示版本历史和所选提交的文件/补丁详情。
- 查看工作区状态、暂存区与工作树 diff，按文件或 hunk 暂存/取消暂存并提交。
- 创建、切换本地分支，以及执行 fetch、pull 和 push。
- 显示远端、上游及 ahead/behind 状态；可从历史提交恢复工作区并生成保留历史的新提交。

### Usage 与外观

- 按日、周和模型聚合 API 请求、输入/输出/缓存 Tokens 与估算成本。
- 图表、汇总指标和明细表使用同一份跨会话持久化数据。
- 支持每日或每月成本预算及通知阈值，达到阈值后发送一次系统通知。
- 字体族、字号、强调色和代码高亮主题保存后即时生效，并在重启后保留。

## 结构

- `src/boot.ts`：启动 `web` profile，挂载桌面 host 插件，并返回 loopback URL。
- `src/main.ts`：Electron 生命周期、托盘、菜单、通知、主题和窗口恢复。
- `src/preload.cts` / `src/desktop-ipc.ts`：context-isolated renderer bridge 与 IPC 数据校验。
- `src/host/*`：外观、文件、Git、Usage、目录选择和定时任务的本地 API。
- `plugins/client/src/client/*`：设置页、会话头、Git、Usage、命令面板和对话增强等 UI overlay。
- `src/smoke.ts` / `src/render-smoke.ts` / `src/desktop-runtime-smoke.ts`：host、页面和 Electron runtime 三层验证。

## 已知限制与后续

- Git 面板默认跟随当前会话的工作区；`DSH_DESKTOP_GIT_ROOT` 可覆盖根目录。非 Git 目录会显示明确的空状态。
- 用量成本基于内置 DeepSeek 率卡估算，不会实时抓取服务端价格。
- 检查点恢复以“已完成轮次”为边界，通过创建子会话实现，不会截断或覆盖原会话。
- GitHub Actions 在推送 `v*` tag 后构建 macOS、Windows 和 Linux 安装包并创建 GitHub Release；版本与 tag 必须严格对应。
- macOS 自动更新要求 Developer ID 签名及公证；Windows 建议配置代码签名以减少 SmartScreen 警告。Linux 的应用内替换仅适用于 AppImage，DEB 用户会被引导到发布页。
- Electron 不支持 Android。Android 版需要单独的移动客户端与可远程访问、经过认证的 DSH 服务，不能直接复用当前仅绑定 `127.0.0.1` 的 Electron/Node 运行时。
- 本地 Web 服务不使用额外 token 鉴权，安全模型与 `dsh web` 相同：仅绑定回环地址并执行同源校验。

完整发布步骤、签名变量和更新行为见 [`docs/RELEASING.md`](docs/RELEASING.md)。

## 协议

MIT。基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT），桌面端仅新增 Electron 壳层。
