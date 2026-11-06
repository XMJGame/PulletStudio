# 开发运行与验证

2026-11-06 V2：日常自由创作仅需 API/Web 与 Generation Worker。文本分析和预演 Worker 属于旧兼容能力，按需启动。L1 升级前备份，构建后重新启动全部 Generation Worker；新上下文的租约保护会拒绝旧二进制领取任务。入口和实际范围见 [自由创作](../LIGHT-CREATION.md)。

更新：2026-11-05。主栈NestJS/React/Drizzle/SQLite，本机不依赖Docker、PostgreSQL或Redis。当前只验收本机开发，正式局域网/TLS/部署另做。运行配置见根.env.example，不输出或提交.env内容。

## 安装与启动

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

G0画布另有 `npm run test:canvas`：只构建Web并运行playwright.canvas.config.ts，独立Vite/5191，无API/数据库，不重走原生产链初始化。CI在已构建后直接运行该配置。具体边界见[CANVAS-LAB](../CANVAS-LAB.md)。

## 备份与恢复

正式画布使用 `npm run test:boards`，已构建时可运行 `npx playwright test --config playwright.boards.config.ts`。独立 API 3112、Web 5192、SQLite、Worker 和 ComfyUI Mock。5 个场景覆盖固定引用、冲突恢复、权限、交互，以及关闭画布后生成归档、候选比较与选片。test:boards 和 test:workflows 共用端口，须顺序执行。

```powershell
npm run db:backup
```

在线SQLite快照位于data/backups，检查完整性与外键，包含已提交WAL内容。数据库备份不包含媒体和Provider密钥，按敏感资料保管，并增加工作目录以外的备份。

恢复前停止API及相关Worker，保留原库和-wal/-shm；复制备份为一个新本地数据库文件，配套恢复完整媒体根/标记及原加密密钥，调整DATABASE_PATH/MEDIA_ROOT后启动检查。不要覆盖现用库、拼凑不同时间点的文件或删除旧库。完整步骤和校验命令以[LOCAL-MEDIA](../LOCAL-MEDIA.md)为准。

## 当前验收界限

工作流中心使用 `npm run test:workflows` 构建并运行 4 项图解析测试和 8 项浏览器验收。场景使用独立 Worker 和 ComfyUI Mock，包含实例诊断、手动路由及试跑和正式生成归档。test:workflows 与 test:boards 共用隔离端口 3112/5192，须顺序执行。

启用 G2-C2 前同时升级 API、Web 和 Generation Worker。数据库保护路由任务，旧 Worker 无法取得这类任务的租约。已经入队的绑定任务仍按原连接执行。

工作流字段或试跑功能更新后，重新构建并同时更新 API 与 Generation Worker。旧 Worker 读取到试跑任务时无法完成试跑归档，数据库会阻止把试跑产物登记为生产素材。升级前先备份。在忽略的独立目录生成迁移并补齐 SQL 和保护，再放入正式 SQL 和快照，最后登记 journal。

最新证据见[实施状态](../IMPLEMENTATION-STATUS.md)。Mock证明协议/权限/恢复，不能证明远端模型画质；真实I2V已独立验收，真实文本/T2I/T2V、正式作品、多GB/长片、LAN/TLS/S3及灾备仍需要对应门禁。详细历史不再塞入此运行手册。
