# 开发运行与验证

> 2026-11-06 后续决定：[ADR-012](../ADR-012-remove-retired-creation-ui.md) 已删除 G0、旧创作/镜头/编译/预演 UI 及兼容菜单，覆盖下文对应保留建议。历史固定引用与后台依赖保留；[多画布与后续顺序](../architecture/ASSET-CANVAS-IMPLEMENTATION.md) 以实施状态为准。

2026-11-06 V2：日常自由创作仅需 API/Web 与 Generation Worker。文本分析和预演 Worker 属于旧兼容能力，按需启动。L1 升级前备份，构建后重新启动全部 Generation Worker；新上下文的租约保护会拒绝旧二进制领取任务。入口和实际范围见 [自由创作](../LIGHT-CREATION.md)。

更新：2026-11-06。主栈NestJS/React/Drizzle/SQLite，本机不依赖Docker、PostgreSQL或Redis。当前只验收本机开发，正式局域网/TLS/部署另做。运行配置见根.env.example，不输出或提交.env内容。

多参考图片执行使用增量迁移 0042。升级前运行 `npm run db:backup`，停止旧 Generation Worker，构建新版后再启动 API 与全部 Worker。数据库会拒绝旧 Worker 领取多图任务。

ModelScope 文生图使用增量迁移 0043，同样需备份并统一升级 API、Web 和 Generation Worker。工作区的「API 设置」保存加密的文生图凭据。画布生成节点切换到「API · ModelScope」后使用固定的 Qwen Image 2512 配置。平台拒绝鉴权的任务会显示具体原因，丢失提交确认的任务不会自动重发。

可选参考图使用增量迁移 0044 的租约保护。启用前按同样步骤备份并升级所有 Generation Worker。

参考视频与音频使用增量迁移 0045 的租约保护，需同样统一升级。ComfyUI 文件上传仍使用原生接口，音视频使用输入目录根层，工作流必须显式配置其读取及解码路径。

## 安装与启动

无需开发环境的本机体验方式见 [Windows 体验包](LOCAL-PREVIEW.md)：编译后的 Web、API 与 Generation Worker 使用包内独立数据库和媒体目录，自带运行时；通过 `start.cmd` / `stop.cmd` 操作，不迁移现用工程库。构建后 `npm run package:preview -- 新输出目录` 可生成白名单 ZIP；它不是正式 LAN/TLS 部署。

首次或依赖锁文件变化时，在仓库根执行；正常开发不反复安装依赖。

```powershell
npm ci
npm run setup
npm run db:migrate
```

`setup`只补充缺少的环境配置，不覆盖已有密钥。首次初始化用本机SETUP_TOKEN，管理员自行设置账户，密码8–16位，无默认账户。

API/Web分别在独立终端运行：

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

页面http://127.0.0.1:5173，API默认3100；健康检查/health/live、/health/ready；当前接口文档/api/docs、/openapi.json。确切路由以实际Controller与本次启动OpenAPI为准，旧03-DATA-API只是历史设计。

需要对应后台任务时，先构建一次，再分别在独立终端启动相关Worker。它们运行同一套API编译产物，尚无独立apps/worker工程。

```powershell
npm run build
```

| 能力 | 独立进程命令 | 说明 |
|---|---|---|
| AI分镜分析 | `npm run worker:text` | 未配置真实模型可使用手工创作；自动测试使用隔离Mock |
| ComfyUI生成 | `npm run worker:generation` | 使用管理员配置的受信连接/固定工作流 |
| 可选低清故事板预演 | `npm run worker:animatic` | 仅用FFmpeg，不调模型，不是专业剪辑器 |

Worker不自动热更新；涉及其代码变更后构建并重启对应进程。重启前检查活动任务和恢复规则，不为文档整理停止用户任务。

## 媒体与数据库

- Node.js≥22；媒体导入/预演和媒体测试需要FFmpeg/FFprobe。Windows可放在忽略目录data/tools/ffmpeg/bin，或通过FFMPEG_PATH/FFPROBE_PATH配置。
- 默认数据库data/studio.sqlite，相对路径以仓库根解析；API启动会自动应用迁移。数据库必须位于后端本地持久化盘，不放SMB/NFS。
- 默认媒体根在数据库目录下media。Local已验收，Mounted/NAS/S3没有正式适配验收；不要把NAS“可挂载”理解成存储迁移/权限已完成。
- **生成迁移文件之前先备份**：开发监视服务可能自动应用新迁移。禁止改写已应用SQL/日志、直接重建旧表或移动数据库/媒体目录整理工程。

## 检查节奏

开发中先构建API并运行受影响测试文件，例如交付包：

```powershell
npm run build --workspace @pullet-studio/api
node --test apps/api/test/media-package.test.mjs
```

阶段结束运行适合本次改动的检查：

```powershell
npm run typecheck
npm run format:check
npm test
npm run test:e2e
```

`npm test`会先编译API；`test:e2e`会先构建两个应用。如果同一代码已完成构建，可以直接调用Node测试入口/`npx playwright test`避免重复编译，但须明确记录先后顺序。无新代码、失败或未决问题不重复全量。独立只读检查可并行，有依赖的构建/修改/迁移保持顺序。

Playwright默认本机Edge，支持PLAYWRIGHT_CHANNEL指定Chrome/Chromium。当前一条完整业务场景调用多段flow，使用独立SQLite/媒体/端口及Mock；“1/1”不等于只有一次点击，也不代表所有测试已模块化。截图/trace位于忽略的test-results。拆分独立场景列入后续工程任务，避免为目录整理重写现有测试。

CI配置在.github/workflows/checks.yml，Ubuntu/Node24/FFmpeg/Chromium。远端某次提交是否通过要单独查对应运行，不能拿本机结果代替；本轮不重装依赖或重跑远端CI。

正式画布使用 `npm run test:boards`，已构建时可运行 `npx playwright test --config playwright.boards.config.ts`。独立 API 3112、Web 5192、SQLite、Worker 和 Mock ComfyUI。覆盖完整 UI 创作链、固定引用、冲突恢复、权限、交互和候选入库。工作流浏览器使用 `playwright.workflows.config.ts`；全局设置使用 `npm run test:settings` 或已有构建下的 `npx playwright test --config playwright.settings.config.ts`。三套共用端口，须顺序执行，运行时不修改 Vite 源码。当前数量见[实施状态](../IMPLEMENTATION-STATUS.md)。

评审原型可用 `npm run dev:studio-review` 在 5196 查看，测试用 `npm run test:studio-review`。原型使用隔离示例数据，正式创作仍从 Web 默认入口进入。

## 备份与恢复

```powershell
npm run db:backup
```

在线SQLite快照位于data/backups，检查完整性与外键，包含已提交WAL内容。数据库备份不包含媒体和Provider密钥，按敏感资料保管，并增加工作目录以外的备份。

恢复前停止API及相关Worker，保留原库和-wal/-shm；复制备份为一个新本地数据库文件，配套恢复完整媒体根/标记及原加密密钥，调整DATABASE_PATH/MEDIA_ROOT后启动检查。不要覆盖现用库、拼凑不同时间点的文件或删除旧库。完整步骤和校验命令以[LOCAL-MEDIA](../LOCAL-MEDIA.md)为准。

## 当前验收界限

Board 与 Workflow 套件包含实际浏览器 125%/150% 缩放场景：使用 `tests/fixtures/browser-zoom.mjs` 在独立测试 profile 中调用浏览器 [tabs.setZoom/getZoom](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom)，读回倍率并验证固定 1440×900 下的 innerWidth 和 devicePixelRatio，再操作项目、画布、候选、资源及提示词/工作流管理。临时扩展只存在于忽略的测试输出目录，不使用用户浏览器配置，也不加入应用。正式库管理另覆盖四档分辨率和深浅主题；此证据区别于等效 CSS 视口。

先依次运行 Board、Workflow 套件，再运行 `npm run review:ui`，可收集 18 张代表性正式页面截图到 `docs/review/studio-ui-v2/`，来源清单记录原截图路径和分辨率。两套浏览器测试共用端口，不能并行启动。收集脚本只读取 PNG 白名单，不收集 DB、profile、运行媒体、trace 或环境文件。CI 无论成功或失败都上传有界 PNG 和错误摘要 artifact，保留 14 天，不再上传整个测试目录。完整评审矩阵见[正式界面评审包](../review/studio-ui-v2/README.md)。

工作流中心使用 `npm run test:workflows` 构建并运行图解析测试和浏览器验收。场景使用独立 Worker 和 Mock ComfyUI，包含实例诊断、手动路由及试跑和生成归档。已有构建时可分别运行 `npm run test:workflow-graph` 和工作流 Playwright 配置。

启用 G2-C2 前同时升级 API、Web 和 Generation Worker。数据库保护路由任务，旧 Worker 无法取得这类任务的租约。已经入队的绑定任务仍按原连接执行。

工作流字段或试跑功能更新后，重新构建并同时更新 API 与 Generation Worker。旧 Worker 读取到试跑任务时无法完成试跑归档，数据库会阻止把试跑产物登记为生产素材。升级前先备份。在忽略的独立目录生成迁移并补齐 SQL 和保护，再放入正式 SQL 和快照，最后登记 journal。

最新证据见[实施状态](../IMPLEMENTATION-STATUS.md)。Mock证明协议/权限/恢复，不能证明远端模型画质；真实I2V已独立验收，真实文本/T2I/T2V、正式作品、多GB/长片、LAN/TLS/S3及灾备仍需要对应门禁。详细历史不再塞入此运行手册。
