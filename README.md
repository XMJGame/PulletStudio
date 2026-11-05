# Pullet Studio

Web多用户AI影视创作与素材生产平台，主栈NestJS、React/Vite、Drizzle和SQLite。Provider与Storage保留独立边界，工作区/项目权限从第一版实施。

**当前已具备基础生产链，尚未完成团队V1与正式部署验收。** 已实现原文导入、AI分镜草案及人工采纳、完整镜头卡/提示词、媒体导入/生成、资产版本、Take审核/选片、标准交付包及可选低清预演。官方MiniMax H3单首帧I2V已通过实机；文本/T2I/T2V主要由Mock验收。画布已有G0独立交互原型，正式项目引用/生成接入、团队指派/批次/评论、Mounted/S3和正式部署仍待开发。

产品入口为生产工作台和创作画布（G0原型），正式剪辑/调色/转场/合成/混音交外部软件。保留轻量故事板预演，重点把原件、选片、版本与清单有序交给后期；不开发专业剪辑器。完整范围见[ADR-009](docs/ADR-009-production-and-postproduction-handoff.md)。

右上角“创作画布原型”或`/canvas-lab.html`可体验参考/提示词/配置/多方案比较、连线、布局保存及本地媒体预览。当前是隔离样例，不读取项目或调用模型，见[CANVAS-LAB](docs/CANVAS-LAB.md)。

## 从哪里开始

- [当前完成情况与后续计划](docs/IMPLEMENTATION-STATUS.md)：唯一实时排期与测试证据。
- [文档导航](docs/README.md)：按产品、模块、运行、历史查阅，避免重读旧路线。
- [产品基线](docs/MASTER-PLAN.md)：长期需求，用户当前决定及有效ADR优先。
- [工程目录与整理规则](docs/architecture/REPOSITORY-MAP.md)：代码、测试、文档与运行数据的实际位置。
- [开发运行与恢复](docs/operations/DEVELOPMENT.md)：完整命令、Worker、检查节奏及备份。

## 本地开发

Node.js≥22、npm；媒体能力及媒体测试需要FFmpeg/FFprobe。当前不依赖Docker、PostgreSQL或Redis。

首次安装在仓库根执行：

```powershell
npm ci
npm run setup
npm run db:migrate
npm run dev:api
```

另开终端运行`npm run dev:web`，打开http://127.0.0.1:5173。首次初始化使用本机.env中的SETUP_TOKEN，自行设置账户和8–16位密码，无默认账户；setup不覆盖已有环境密钥。

有任务执行需求时，先`npm run build`，再在各自终端运行所需Worker：

| 命令 | 用途 |
|---|---|
| `npm run worker:text` | 原文范围分析/AI分镜 |
| `npm run worker:generation` | ComfyUI生成、结果核对与归档 |
| `npm run worker:animatic` | 可选FFmpeg低清预演 |

未配置模型也可以手工创作、导入素材、审核与交付。ComfyUI使用管理员受信连接及固定API图，不移动、不重装用户的ComfyUI或模型。工作流绑定与参数见[使用说明](docs/COMFYUI-GENERATION.md)。

API默认http://127.0.0.1:3100，存活/就绪检查为/health/live和/health/ready；当前接口文档/api/docs、/openapi.json。当前仅本机开发监听，LAN/TLS/正式部署未验收。

## 交付与验证

[标准素材包](docs/MEDIA-PACKAGES.md)包含按类型归档的已批准选片原件、ShotList.csv、ProductionNotes.md及manifest.json。固定卡/Take/媒体/批准/来源，复用原件去重，区分计划与实测时长；旧v1包保持兼容。独立声音/SRT附件和编辑器工程交换尚未实现，不能把包当完整项目备份。

```powershell
npm run typecheck
npm run format:check
npm test
npm run test:e2e
npm run db:backup
```

最近代码阶段：176/176 Node测试、Edge全流程1/1、类型/格式/构建通过。本地结果与真实模型/正式作品/远端CI证据分开，详见实时状态。开发中先跑相关测试，文档整理不重复业务全量。

SQLite默认data/studio.sqlite，必须放后端本地持久化盘，不能放SMB/NFS。API启动会应用迁移，生成迁移文件之前先备份。数据库快照不包含媒体和Provider加密密钥；完整备份与恢复见[LOCAL-MEDIA](docs/LOCAL-MEDIA.md)。运行数据、密钥、备份、截图和依赖不提交到Git。

## 目录

| 路径 | 当前用途 |
|---|---|
| apps/api | API、三类Worker入口、业务模块、SQLite schema/迁移及Node测试 |
| apps/web | React工作台、表单与媒体/任务/审核/交付界面 |
| packages/contracts | 已使用的Storage接口及尚未统一的Provider设计类型 |
| tests/e2e、tests/fixtures | 隔离浏览器验收、Mock和合成媒体工具 |
| tools | 环境初始化、API监视、媒体校验 |
| docs | 当前基线/状态/ADR/指南，及architecture/modules/operations/history/archive分类 |
| infra、examples | 历史Compose示例与通用绑定示意，非本机配置或正式部署方案 |

当前不提供PostgreSQL驱动、自动双库切换或SaaS；未来扩展须独立兼容、权限和迁移验收。
