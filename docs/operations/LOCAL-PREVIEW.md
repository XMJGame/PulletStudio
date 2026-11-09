# 本机体验包：运行、停止与反馈

这是 Windows x64 的 Web + Server 体验包，浏览器是界面，不是新的桌面客户端。包内包含匹配的 Node.js、API 生产依赖、编译后的网页、Generation Worker、FFmpeg/FFprobe。无需安装 Node、npm、Docker 或数据库；真实生成仍需可用的 ComfyUI / Provider 与正确工作流。

## 使用者操作

1. 将 ZIP 完整解压到本机 SSD 上可写的普通目录。不要在压缩包中运行，不要放 NAS / 网络共享盘。已准备的目录可以直接使用，不必再次解压。
2. 双击 `start.cmd`，等待显示 `Running`，浏览器打开 <http://127.0.0.1:5188>。启动窗口关闭后后台仍运行；已有实例会复用，端口被其他服务占用会提示失败，不结束其他程序。
3. 第一次打开需要创建自己的账号：初始化密钥在包内 `data/FIRST-START.txt`，复制到初始化页面，填写姓名、邮箱、工作区名称及 **8–16 位密码**。没有默认账号。以后使用自己的邮箱和密码登录；这是新体验空间，旧工程中的账号、项目与素材仍在原位置。
4. 工作台左下「设置」配置 ComfyUI 与 API。实例在当前工作区全局共用，无需先创建项目；工作流仍按项目选择。正常创作：创建项目 → 新建画布 → 导入素材 / 填写提示词 → 选择工作流生成 → 预览/比较 → 入库或下载原件包。视频可通过「视频提帧」拖动选位置、提取预览、确认保存并加入画布。
5. 暂停使用时先等待页面中的上传/提帧/下载结束，再双击 `stop.cmd`。它会停止网页、API 和 Generation Worker，保留全部数据。如果正在执行 Worker 步骤，会等待结束；窗口提示仍在停止时稍后用 `status.cmd` 检查。停止不等于取消远端 ComfyUI 任务，重新启动后按原任务状态恢复。
6. 双击 `status.cmd` 可查看当前运行状态。重启电脑后需要再次 `start.cmd`，不会随系统自动启动。

我负责代码、打包、自动测试、运行检查和故障修复；你只需要设置自己的账号、使用并反馈。真实模型效果需要在目标服务可用时验收，离线体验不预置付费服务或伪造生成结果。ModelScope 账号绑定继续暂缓，不需要你现在操作。

## 文件与数据

| 位置 | 用途 |
|---|---|
| `start.cmd` / `stop.cmd` / `status.cmd` | 启动 / 停止 / 状态 |
| `使用说明.md` | 本说明 |
| `VERSION.json` / `FILES.json` | 来源提交、构建时间及出厂文件清单 |
| `apps/` / `node_modules/` / `runtime/` / `tools/` | 程序及自带运行环境 |
| `data/studio.sqlite`、相关 `-wal/-shm` | 本体验空间的数据库，首次启动自动创建 |
| `data/media/` | 本体验空间的素材 |
| `data/preview-config.json` | 本机端口、初始化及 Provider 加密密钥；不可泄露或随意重建 |
| `data/FIRST-START.txt` | 仅首次初始化使用的本地密钥 |
| `data/logs/` | launcher、API、generation-worker 日志 |

旧工程 `data/studio.sqlite` 不参与体验包启动或打包。不要手工把旧库/素材覆盖到体验包；旧版本升级需要单独备份、迁移与三端版本一致性检查。删除体验包目录也会删除其中新创作的数据，清理前先备份。

备份最直接的方式：`stop.cmd` 完成后，整体复制体验包目录到另一个本地/备份位置，保留 `data`、媒体和加密配置。备份副本不要与原件同时运行。升级时保留旧包，使用新目录体验，不覆盖旧数据。当前包只监听本机；不提供局域网共享、TLS 或正式服务器部署。

## 故障反馈

页面打不开先运行 `status.cmd`，再查看 `data/logs/launcher.log` 和 `api.log`；生成任务异常查看页面错误与 `generation-worker.log`。反馈操作步骤、截图、发生时间和任务错误即可。不要发送 `preview-config.json`、FIRST-START、完整数据库、API Key 或整份日志目录。

默认端口 Web 5188、内部 API 3188。端口冲突时停止本包后修改 `data/preview-config.json` 中对应端口，不修改其他字段；手动打开新的 Web 地址。静态服务只公开编译后的 Web，不公开 `data`、配置或任意本地文件。它是本机验收入口，不替代正式部署网关。

## 开发者重新打包

在已安装依赖且媒体工具位于忽略目录 `data/tools/ffmpeg` 的 Windows x64 工程执行。匹配当前 Node 版本的官方 LICENSE 需预先保存在 `data/tools/node/LICENSE`（来源为 Node 官方仓库对应版本标签的 LICENSE），打包时一并保留：

```powershell
npm run build
npm run package:preview -- G:/XuMingJun/2026/Pullet/releases/PulletStudio-preview-新版本
```

输出一个新目录及同名 `.zip`，已有输出拒绝覆盖。只收集明确白名单的程序文件及 API 生产依赖，不复制开发 `.env`、数据库、用户媒体、凭据、Mock、浏览器 profile 或测试产物。运行时及媒体工具保留原许可/构建来源说明。包由匹配的 Node/native SQLite 组合生成，不是跨平台安装包；公开分发另行准备完整的发布和第三方分发材料。

验收使用另一个新解压副本，不能指向使用者的体验数据。设置 `PULLET_PREVIEW_TEST_ROOT` 为 `data/e2e` 下的该副本后，执行 `npm run test:preview`；它配置专用 5192/3112 端口、初始化测试账号并结束服务。随后从副本用自带 Node 启动，再运行 `npx playwright test --config playwright.preview.config.ts`，完成后用同一副本的停止命令结束。浏览器配置校验 QA 目录和专用初始化配置，不自动连接正常体验空间。
