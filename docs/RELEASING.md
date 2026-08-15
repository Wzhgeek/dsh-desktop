# Dsh Desktop 发布手册

## 支持范围

当前发布流水线生成三类桌面安装包：

| 平台 | 架构 | 产物 | 应用内更新 |
|---|---|---|---|
| macOS | x64、arm64 | DMG、ZIP | 支持；必须使用已签名、公证的安装包 |
| Windows | x64 | NSIS EXE | 支持；正式分发建议代码签名 |
| Linux | x64 | AppImage、DEB | AppImage 支持；DEB 打开 GitHub Release 手动安装 |

Electron 没有 Android target。当前应用还直接依赖 Electron main、Node.js、Harness host、Git 与本地文件系统，因此不能把同一份程序包装成 Android APK。Android 需要另建移动端客户端，并让它连接一个可远程访问且具有认证、TLS、权限隔离的 DSH 服务；在这个服务边界完成前，不发布不可工作的 Android 占位包。

## 应用内更新

应用通过 `electron-updater` 读取 GitHub Release 中的更新元数据：

- 启动约 15 秒后检查一次，之后每 6 小时检查一次。
- 用户可在「设置 → 通用设置 → 应用更新」手动检查。
- 下载完成后由用户确认重启安装，不会强制中断当前会话。
- `rc` 等预发布版本会继续接收预发布更新；稳定版只接收稳定更新。
- 从源码运行或使用未安装的开发构建时不执行更新，设置页会显示相应状态。

发布资产中的 `latest.yml`、`latest-mac.yml`、`latest-linux.yml` 和 `*.blockmap` 是更新所需文件，不能从 Release 中删除。

## GitHub Secrets

没有签名 Secret 时，CI 可以生成测试安装包，但 macOS 自动更新和面向普通用户的安装体验不完整。正式发布前在仓库的 Actions secrets 中配置：

### macOS

| Secret | 内容 |
|---|---|
| `MAC_CSC_LINK` | Developer ID Application 证书的 base64、文件路径或安全 URL |
| `MAC_CSC_KEY_PASSWORD` | 证书导出密码 |
| `APPLE_ID` | 用于公证的 Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple ID 的 app-specific password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

### Windows

| Secret | 内容 |
|---|---|
| `WIN_CSC_LINK` | 代码签名证书的 base64、文件路径或安全 URL |
| `WIN_CSC_KEY_PASSWORD` | 证书密码 |

## 发布流程

1. 保证 `main` 分支测试和构建通过，并更新版本号：

   ```sh
   pnpm test
   pnpm build
   ```

2. 提交版本变更并推送 `main`。

3. 创建与 `package.json` 完全一致的 annotated tag。例如版本为 `0.1.0-rc.6`：

   ```sh
   git tag -a v0.1.0-rc.6 -m "Dsh Desktop v0.1.0-rc.6"
   git push origin main
   git push origin v0.1.0-rc.6
   ```

4. `.github/workflows/release.yml` 会分别在 macOS、Windows、Linux runner 构建，并在全部成功后创建 GitHub Release、上传安装包、更新元数据和 `SHA256SUMS.txt`。

5. 在 Actions 页面确认三个平台 job 均成功，再分别安装一次产物并执行首次启动检查。预发布 tag（版本包含 `-`）会创建 prerelease。

也可在 Actions 页面手动运行工作流并输入一个已经存在的 tag；工作流不会从未提交的工作区构建，也不会替用户创建 tag。

## 本机验证

当前平台可先生成未安装目录：

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm pack:dir
```

macOS、Windows、Linux 的最终安装程序必须在各自系统上验证。不要把本机 `release/` 目录提交到 Git；正式产物由 GitHub Actions 上传。
