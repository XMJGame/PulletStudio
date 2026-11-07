# Pullet Studio

Web多用户AI影视创作与素材生产平台，主栈NestJS、React/Vite、Drizzle和SQLite。Provider与Storage保留独立边界，工作区/项目权限从第一版实施。

当前主线是资产、创作画布、工作流、生成候选与素材复用。空项目可以直接粘贴提示词生成，候选预览、下载、复用、存入素材库或引用回画布；不要求剧本、镜头或已编译提示词。旧创作页面与兼容菜单已删除，历史数据继续受后台授权保护。[产品 V2](docs/PRODUCT-V2.md) · [删除决策](docs/ADR-012-remove-retired-creation-ui.md)

正式剪辑/调色/转场/合成/混音交外部软件；不开发专业剪辑器。工作区权限、媒体版本、Provider/Storage 和实例调度保留。[V2 取舍审计与顺序](docs/architecture/PRODUCT-V2-AUDIT.md)

正式产品只使用一套 React Flow/Board。G0 原型源码、页面、测试、构建与 CI 入口已删除。

点击项目直接进入上次使用的画布，用「切换 / 新建画布」管理多张画布。项目资源库可导入、筛选和预览媒体，多画布共用固定版本。生成节点可就地应用提示词、选择工作流、查看或对照候选；关闭页面后任务继续。[正式画布使用指南](docs/CREATIVE-CANVAS.md)

项目工作流中心支持 API 图导入、版本管理、创作参数和依赖诊断。管理员可直接粘贴提示词试跑；自由创作可用已保存固定版本，正式镜头保留团队发布机制。[工作流中心](docs/WORKFLOW-CENTER.md)

项目提示词库可保存、搜索、复制和修订完整正负词，在不同画布或生成窗口应用固定版本；修改不影响历史任务。[提示词库](docs/PROMPT-LIBRARY.md)

画布内可添加生成节点，连接提示词和单张首帧，保存后执行。结果可预览并加入画布，历史任务保留执行时的画布修订。[画布操作](docs/CREATIVE-CANVAS.md)

## 从哪里开始

- [当前完成情况与后续计划](docs/IMPLEMENTATION-STATUS.md)：唯一实时排期与测试证据。
- [文档导航](docs/README.md)：按产品、模块、运行、历史查阅，避免重读旧路线。
- [最终产品与执行合同](docs/PRODUCT-EXECUTION-CONTRACT.md)：当前最高产品基线；[MASTER-PLAN](docs/MASTER-PLAN.md)保留长期及历史需求。
- [正式界面评审包](docs/review/studio-ui-v2/README.md)：真实接口截图、验收矩阵、能力范围与复现方式；最终视觉认可和 main 合并另需确认。
- [工程目录与整理规则](docs/architecture/REPOSITORY-MAP.md)：代码、测试、文档与运行数据的实际位置。
- [开发运行与恢复](docs/operations/DEVELOPMENT.md)：完整命令、Worker、检查节奏及备份。

## 本地开发

只想体验当前版本可使用 [Windows 本机体验包说明](docs/operations/LOCAL-PREVIEW.md)：自带运行环境，双击 `start.cmd` / `stop.cmd`。新体验空间与旧工程数据隔离。开发者构建后通过 `npm run package:preview -- 输出目录` 打包，不提交运行数据和二进制包。

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
| `npm run worker:generation` | ComfyUI生成、结果核对与归档 |

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

L2-A 本机通过 203 项 API、4 项图解析、9 项工作流、5 项画布场景和 1 项新主入口场景。旧 UI 专用流程已删除，数据与后台不变量继续回归；新增模型链路用隔离 Mock。早期官方 MiniMax H3 单首帧 I2V 已独立实机验收。[实施状态](docs/IMPLEMENTATION-STATUS.md)

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
| examples | 通用工作流绑定示意；已删除与当前运行无关的 PostgreSQL/Redis Compose 示例 |

当前不提供PostgreSQL驱动、自动双库切换或SaaS；未来扩展须独立兼容、权限和迁移验收。
