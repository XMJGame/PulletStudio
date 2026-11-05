# Pullet Studio — 现有仓库审计与团队级 V1.0 续开发实施方案

> 2026-11-05范围修订：[ADR-009](../ADR-009-production-and-postproduction-handoff.md)。生产工作台与创作画布为核心入口，专业后期交给外部软件。保留已交付顺序预演/媒体处理，不新增多轨剪辑、转场、关键帧、调色、合成或专业混音；声音与字幕作为素材来源/交付管理。原件、CSV/JSON/制作说明优先，SRT有可靠来源后接入，OTIO/FCPXML后置验证。

> 文档版本：1.0 · 制定日期：2026-11-05  
> 基准仓库：`https://github.com/XMJGame/PulletStudio` · `main` · 读取时 Git Tree SHA：`9c0ad77d5bc23ca2ee0e0f24737ebacac303dcec`  
> 文档性质：**续开发实施基线 / 待 Codex 对本地最新代码复核**。不代表已修改仓库、已执行测试或已迁移数据。  
> 适用对象：桌面 Codex、产品负责人、未来团队协作者。

## 0. 执行摘要：冻结决策

**Pullet Studio V1.0 直接面向团队级 AI 影视创作与生产，但以逐阶段可运行、可验收的垂直生产链实施。** 一个人可完成全部创作；多人可分工、协作、批量生产、审核和交付；架构允许未来自部署开源。

**不整体迁移 FastAPI，不重建仓库，不推倒已有业务代码，不以 Fork 外部项目代替产品内核。** 现有 NestJS 11 / TypeScript / React 19 / Vite / Drizzle / SQLite 作为主栈。Python/FastAPI 未来仅作为有实际需求的独立媒体或 AI 计算服务，禁止成为第二套认证、权限、项目和业务数据库系统。

以下为制定时的依赖分组，当前执行顺序与已完成功能唯一见[实时状态](../IMPLEMENTATION-STATUS.md)，不能按旧任务重复开发。

**依赖分组**：

1. 完整正式镜头卡编辑、Prompt Compiler 与可导出分镜文档；
2. 统一媒体存储、手工导入、角色／场景／道具／声音资产、资产版本；
3. 图片/视频 Generation Provider 与可靠任务队列、ComfyUI 首个真实联调；
4. Take 审核、分工、评论、通知、批量生成；
5. VO/对白、基础时间线、预演、交付；
6. 统一资产之上的无限画布、Skills/Recipes/Agent；
7. 开源自部署、插件 SDK、可移植项目包、规模验证。

**持续防止产品退化为“项目管理系统”**：每个阶段必须产出能推动真实影视制作的能力。

## 1. 审计范围、证据、边界

### 1.1 实际读取到的仓库证据

- `README.md`：状态明确写着原文导入、后台 AI 分镜草案、人工采纳为正式镜头已打通，V1 尚未完成，真实模型未联调。
- `docs/IMPLEMENTATION-STATUS.md`：记录 24 张业务表、14 次迁移、70/70 Node 测试、Edge E2E 1/1；**这些是仓库记录，并非本次远程重新执行**。
- `apps/api/src/db/schema.ts`：工作区、项目、嵌套制作单元、镜头、剧本不可变历史、原文证据、文本模型、分析任务、Proposal 审核与采纳、镜头卡历史等实际表。
- `apps/api/src/analysis/{analysis-contract.ts,text-analysis-worker.ts}`：分段分析、Zod 结构校验、证据引用、任务租约、重试与不确定提交核实。
- `apps/api/src/production/*`、`apps/api/src/scripts/*`、`apps/api/src/auth/*`：既有领域服务及授权。
- `apps/web/src/components/*`：剧本、制作结构、分镜、草案审核、角色成员、Provider 配置等现有工作台组件；目前多数集中在 `main.tsx`、独立对话框和 `style.css`。
- `packages/contracts/src/{provider.ts,storage.ts}`：**媒体扩展草案接口**，尚非真实 Provider/Storage 实现。
- `.github/workflows/checks.yml`：CI 配置已提交，远程 CI 实际结果需要 Codex 检查。
- `infra/compose.dev.yml`：仍包含 Postgres 和 Redis 旧示例，现有 SQLite 运行不需要它们。
- `docs/{ADR-001-stack.md,ADR-002-database.md,ADR-003-boundaries.md,ADR-004-production-units.md}`：已确认的保留技术栈、数据库增量演进、领域边界、兼容旧 episodes 的 ProductionUnit 结构。
- `AGENTS.md`：强调旧数据与模块保留，主栈不迁移，先影视生产闭环。

### 1.2 必须由 Codex 本机复核的事项

仓库分支可能继续变化；Codex 必须以**本地 Git 工作树 + 最新远端**为准，对照本文件的基线 SHA 做差异审计。不要把仓库的自述“通过测试”替代实际运行 `npm ci`、`npm run typecheck`、`npm run build`、`npm test`、`npm run test:e2e`、数据库迁移、备份恢复和权限回归。

未做逐行漏洞审计或真实 ComfyUI/云供应商联调。任何“已实现”“安全”结论须有代码证据、自动化测试和人工操作证据。

## 2. 为什么此时不换 FastAPI

### 2.1 FastAPI 会带来什么

- 原生接入大量 Python AI/视频/视觉生态：OpenCV、Pillow、PyTorch、Transformers、Diffusers、Whisper、场景分析、3D 处理。
- 长耗时/计算服务可使用 Python 原生任务模型、Pydantic 数据验证和模型 SDK。
- 复杂 Agent 原型可能更容易利用 Python 社区已有实现。

### 2.2 但迁移主后端需要重做什么

现有 NestJS 代码不是空架：认证、CSRF、RBAC、会话、项目、原文锁定、24 表数据迁移、镜头卡历史、Proposal 审批、Worker 租约、安全边界、API 与浏览器测试都已经投入。整体迁移意味着重新实现并验证这些能力，产生数据和行为不一致风险，短期不能提高视频质量。

### 2.3 决定

1. **保留 NestJS 为唯一主业务 API。**
2. 保留现有 Node Text Worker；后续媒体 Worker 可继续 Node 处理流程，调用 FFmpeg 进程或独立媒体服务。
3. 仅当某项功能需要不可替代的 Python 算法时，新增 `workers/python-media` 或 `services/previs-python`，经内部 API / 队列协议调度；不共享 NestJS 的数据库写权限，不单独实现用户/工作区体系。
4. 后续如性能与复杂性数据证明全面迁移确有净收益，另写 ADR 和迁移测试；现在不进行。

## 3. 保留、整理、删除候选、新增：按现有文件落地

### 3.1 必须保留并继续复用

| 仓库路径／模块 | 决定 | 说明 |
|---|---|---|
| `apps/api/src/auth/**` | 保留 | 现有认证、会话、初始化、密码规则；不要重置旧用户 |
| `apps/api/src/production/**` | 保留、逐步拆分 | 项目、成员、ProductionUnit、Shot、编号、RBAC；不迁移旧 ID |
| `apps/api/src/scripts/**` | 保留 | 原始来源 SHA256、不可变剧本版本、锁定、范围引用 |
| `apps/api/src/analysis/**` | 保留并扩展 | 来源可追踪 Proposal、审核采纳、独立 Worker、镜头历史；后续补分层 Story Bible |
| `apps/api/src/providers/{text-provider.ts,text-connections.service.ts,provider-secrets.ts,safe-text-http.ts}` | 保留 | TextProvider 真实实现与凭据/安全机制；媒体 Provider 复用设计原则但不直接硬套文本协议 |
| `apps/api/src/db/schema.ts` 和 `apps/api/drizzle/**` | **全部保留历史** | 只做增量迁移；禁止删旧 SQL、重建数据库、批量重编号 |
| `apps/api/src/db/{backup.ts,database.service.ts,apply-migrations.ts}` | 保留 | 在线备份和 SQLite 配置继续使用；阶段性加媒体备份清单 |
| `apps/web/src/components/{ScriptWorkbench,AnalysisWorkbench,ProposalReviewPanel,StructureWorkbench,ShotEditor,...}` | 保留、渐进重构 | 已有可用页面不是废弃原型；优先复用现有交互与权限逻辑 |
| `.github/workflows/checks.yml`, `tests/e2e/**`, `apps/api/test/**` | 保留并扩充 | 所有测试基线不回退 |
| `docs/ADR-001..004`, `AGENTS.md`, `docs/IMPLEMENTATION-STATUS.md` | 保留并维护 | 历史设计决策不可随意覆盖；新增文档明确优先级 |

### 3.2 保留但需要整理／重构（非删除）

| 位置 | 现状与问题 | 推荐渐进处理 |
|---|---|---|
| `apps/api/src/app.module.ts` | 目前许多控制器/服务集中注册 | 按领域拆 `AuthModule`, `ProductionModule`, `ScriptsModule`, `AnalysisModule`, `AssetsModule`, `GenerationModule`, `ReviewModule`；一次一个模块，不改变 URL 和权限 |
| `apps/web/src/main.tsx` | 以主页面和大量子组件组织，未来画布/多工作台将持续膨胀 | 引入路由与 `AppShell`, `ProjectLayout`, `Page` 分层，保留现有页面作为迁移目标；用 E2E 防回归 |
| `apps/web/src/style.css` | 已有自研样式，缺统一主题 Token | 抽 `tokens.css`、组件变量、暗/亮模式、布局系统；不为了引入 shadcn/Tailwind 重写全站 |
| `packages/contracts/src/provider.ts` | 仅草案，`JobState` 与真实文本队列语义可能不同 | 与实际 Generation Service 一起完善 capability、参数 schema、状态和归档契约，逐步版本化 |
| `packages/contracts/src/storage.ts` | 草案且 `delete` 方法无业务防误删语义 | 定义 Store/Read/Stat/Copy/PresignedDelivery 与版本、权限边界；删除通过有审计的业务命令，禁止普通插件任意删除 |
| `apps/api/src/db/schema.ts` | 已有 24 表，继续膨胀会影响理解 | 可以按领域拆 schema 定义，但需要 Drizzle 迁移和引用充分验证；不为拆文件改物理表名 |
| `docs/MASTER-PLAN.md` | 包含早期 FastAPI/Python 建议，与已生效 ADR 冲突 | 增加“已采纳决策优先级”及现状章节；不盲目整体替换业务需求 |
| `docs/05-DEVELOPMENT.md`, `docs/04-ROADMAP.md` | 留有过时测试数字和历史排期 | 明确标识历史记录；最新进度唯一来源为 `IMPLEMENTATION-STATUS.md` |

### 3.3 可归档／从默认开发路径移除的候选

| 文件／内容 | 建议 | 必须满足的删除条件 |
|---|---|---|
| `infra/compose.dev.yml` 内 Postgres + Redis | **移入 `infra/legacy/` 或标注非当前运行架构** | 搜索脚本/文档/CI 无引用；若保留给未来，重命名 `compose.postgres-redis.example.yml` 并注明不提供可用的数据库切换能力 |
| 旧 `M0 ZIP` 或 `CODEX-START` 等启动文件（若本地存在） | 归档，退出当前执行路径 | 确认 `AGENTS.md` / 新实施计划覆盖有效约束，保留历史记录 |
| 重复的“开发计划”为多个互相矛盾的活跃清单 | 归档历史版本 | `docs/IMPLEMENTATION-STATUS.md` 成为唯一实时状态，统一引用本文件 |
| 空壳 UI、未连接的伪按钮 / 假状态显示 | 替换为真实状态或标记未开放 | 先列清单并补自动化测试，禁止直接隐藏已实现功能 |

**立即删除的核心文件：零。** 数据库 SQL 历史迁移、旧 API 兼容、真实用户数据、测试和工作区权限代码都不得随意删除。

### 3.4 需要新增的模块

- `apps/api/src/assets/`：MediaAsset、AssetVersion、AssetUsage、角色/场景/道具/VoiceProfile、ReferenceSet、版本锁与依赖影响查询。
- `apps/api/src/storage/`：StorageFacade + Local / Mounted / S3 adapter，带鉴权读取、Range、原件哈希、上传校验、媒体元数据。
- `apps/api/src/prompts/`：PromptProfile、PromptCompiler、PromptArtifact、模型提示词方言和版本追踪。
- `apps/api/src/generation/`：ProviderConnection、ModelProfile、WorkflowProfile、GenerationJob、JobOutput、Take；Server-side worker、幂等和调和。
- `apps/api/src/reviews/`：Take review、评论、批准/退回、锁定与通知。
- `apps/api/src/assignments/`：任务分工、负责人、制作状态、批次、任务看板。
- `apps/api/src/timeline/`：基础 TimelineVersion、Clip、音轨策略、FFmpeg Animatic。
- `apps/api/src/exports/`：分镜 JSON/MD/CSV、素材包、清单与重导入；导出任务。
- `apps/web/src/app/`：AppShell、路由、导航、布局及 UI Tokens。
- `apps/web/src/features/{assets,storyboard,canvas,tasks,review,timeline,settings}/`：工作台功能（按阶段新增）。
- `packages/contracts/src/{assets,skills,recipes,events,plugin-manifest}.ts`：领域与扩展稳定契约；先设计再为首个真实调用方实现。
- `docs/architecture/`：本计划、ADR 增量、ERD、插件 SDK、项目包规范、回滚手册。

## 4. 团队级产品目标与范围

### 4.1 项目类型

通用支持：广告、1–3 分钟短视频、解说/纪录片、AI 漫剧、短剧、连续剧、电影。`workFormat`、`narrativeMode`、视觉风格、导演 Profile 彼此独立；不在业务逻辑硬编码神话、水墨或盘古。

### 4.2 工作台

1. **Project Dashboard**：项目状态、制作进度、团队成员、待审核、异常任务、预算（有能力数据时显示）。
2. **Script & Story**：源文件、不可变版本、锁定、AI 分析、人物/场景提取、分集/分场。
3. **Asset Registry**：角色、场景、道具、声音及媒体参考库。
4. **Storyboard**：列表 / 卡片 / 对比，镜头版本、生成策略、提示词、审核、责任人。
5. **Creative Canvas**：React Flow 影视节点、引用/依赖连线、创意探索、可选择提交为正式制作数据。
6. **Tasks & Review**：团队指派、队列、批量处理、审查和反馈。
7. **Preview & Delivery**：镜头顺序/计划时长、可选低清故事板预演、固定原件、声音/字幕来源和交接，不做专业剪辑器。

### 4.3 角色设计

权限角色 (RBAC) 与制作岗位分离：Owner / WorkspaceAdmin / ProjectManager / Editor / Reviewer / Viewer 是权限；编剧、导演、美术、生成操作员、后期是 Assignment role。一个人可兼任多个岗位。角色/资源有效权限由后端计算，不能只根据前端按钮隐藏。

### 4.4 团队协作 MVP

- 单一工作区与多个项目；项目级权限；任务负责人、优先级和截止日期（可选）；评论 @ 成员（后续）；分镜/Take 审批；审计日志；站内通知；批量任务视图。
- 编辑用 `expectedVersion` / 409；避免最后写入者覆盖。暂不以实时 CRDT 为上线前置条件。
- 动态生成预算和配额需在 Provider 支持用量数据时展示实际值；对估算/未知明确标记，不能虚构成本。

## 5. Production Core：必须统一的数据与版本

### 5.1 已有表继续使用

`users`, `sessions`, `workspaces`, `workspace_members`, `projects`, `project_members`, `episodes`, `shots`, `scripts`, `script_revisions`, `script_sources`, `text_connections`, `text_model_profiles`, `analysis_runs`, `analysis_proposals`, `proposal_reviews`, `proposal_revisions`, `script_spans`, `shot_card_revisions`, `shot_script_spans`, `proposal_adoptions`, `audit_events` 等；名称以实际 Schema 为准。

**episodes 物理表作为 ProductionUnit 兼容存储，保留旧 ID/外键**。项目直连 Shot 使用内部 `project_root` 行，但对外不展示。禁止为“命名好看”另建第二套 ProductionUnits 和 Shots 数据。

### 5.2 新增领域对象（分阶段建表）

| 对象 | 关键字段／约束 | 说明 |
|---|---|---|
| `media_assets` | id, workspace_id, project_id?, kind, mime, bytes, sha256, origin, created_by | 逻辑媒体身份，不存绝对路径 |
| `asset_versions` | asset_id, version_no, storage_connection_id, object_key, sha256, metadata, provenance, status | 原件不可覆盖，版本关联不可变 |
| `creative_entities` | workspace_id, project_id?, entity_type(character/scene/prop/voice/style), title, description, status | 统一身份，类型化细节另存 |
| `entity_revisions` | entity_id, revision_no, immutable_json, approved_at/by | 角色造型、声音、场景设定、状态版本 |
| `entity_media_refs` | entity_revision_id, asset_version_id, role(front/side/back/portrait/wide/day/night/voice...) | 绑定三视图、白底图、音色等 |
| `asset_usages` | target_type/id, source_entity_revision_id or asset_version_id, usage_role | 依赖查询和失效影响分析 |
| `director_profiles` / `style_profiles` | version, config, template, scope | 可配置的创作要求，不写死类型 |
| `prompt_profiles` | provider_capability, version, template, requirements, negative_rules | 模型提示词“方言” |
| `prompt_artifacts` | shot_card_revision_id, entity_revision_ids, profile_revision, compiled_text, warnings | 生成过的完整提示词不可变 |
| `generation_connections` / `model_profiles` / `workflow_profiles` | scope, encrypted credentials, capability schema, version | 各层分离，绝不在业务实体保存模型节点 ID |
| `generation_jobs` / `job_outputs` | request snapshot, state, lease, idempotency, provider task ID, output archive state | 工作流运行与产物归档 |
| `takes` | shot_id, asset_version_id, generation_job_id?, take_number, state | 手工素材也能建立 Take |
| `reviews` / `comments` | target, reviewer, decision, immutable event | 审核与反馈历史 |
| `assignments` / `production_batches` | project_id, target, assignee, priority, due_at, state, attempts | 批量生成/审核分工 |
| `board_documents` / `board_revisions` | workspace, project, scope, version, layout_json | 只存画布布局和业务 ID 引用 |
| 已有 `timeline_revisions` JSON / Clip | 固定选片顺序、整数ms、简单入点/时长、keep/mute | 轻量故事板预演，保留历史，不扩展多轨编辑 |
| `export_jobs` | manifest, version, output_asset_id, checksum | 断点恢复与可移植包 |

绝大部分实体须有稳定 UUID、workspace/project scope、created/updated metadata、权限和版本。高频列表添加组合索引；历史采用 append-only，不直接覆盖已审批信息。

### 5.3 角色、场景、道具与声音怎样建模

**角色** `Character` 有稳定身份，挂 `CharacterRevision`；三视图/正面/侧面/背面/头部特写由 `entity_media_refs` 指向不可变素材版本。衣着、年龄阶段、伤痕等用 `AppearanceVariant` 或状态快照；VoiceProfile 单独引用。通过主锚点图生成次视图、管理已过期视图，而不是让四张图互相独立。

**场景** `Scene` 保存环境信息、空间布局、主/反机位参考、日夜/天气/灯光变体、禁用元素及机位连续性。三视图不是所有场景的硬要求。场景版本变化能查询受影响镜头。

**道具** `Prop` 保存相对尺寸、材质、主视图、状态变化、持有者和镜头引用。复杂动作和空间轴线作为可选专业 Skill 规则，而不是强制所有广告执行武打规则。

**声音** `VoiceProfile` 保存 provider voice id、语言、风格、授权/使用说明、样例媒体资产；角色可以在不同语言、不同场景使用不同语音配置，不能把声音强制锁定在单张角色图内。

**场面连续性** `ContinuityLock` 可绑定服装、场景状态、手中道具、相对站位、视线、轴线；生成前检查冲突但允许导演有理由地覆盖。所有引用记录 revision，不凭“当前最新”隐式改变已生成的 Take。

## 6. Prompt Compiler 与导演 Profile

### 6.1 输入与输出

`ShotCardRevision + ScriptSpan(s) + ProjectSettings + DirectorProfileVersion + StyleProfileVersion + CreativeEntityRevisions + MediaReferences + ModelProfileCapability + PromptProfileVersion` → `PromptArtifactVersion`。

每次编译输出：

- `positive_prompt`: **完整可复制**的画面描述 + 统一风格 + 镜头/角色/场景信息；
- `negative_prompt`: 目标模型支持时作为独立字段，不支持时转为兼容表达或显示警告；
- `input_bindings`: 参考图、声音、首尾帧、源文字段及明确顺序；
- `audio_policy`: preserve / partial / mute + VO/BGM/SFX/ambience 计划；
- `warnings`: 引用过期、模型不支持、图片缺失、来源版本变化、生成时长不匹配；
- `provenance`: 全部输入修订 ID、编译器版本、ModelProfile 版本。

### 6.2 模型无关创作意图与适配层分离

先保存模型无关的导演描述，再按模型生成完整提示词；不可将 ComfyUI 节点编号、特定视频供应商语法写进 Shot 的核心字段。编译支持 `preview` 和 `commit`，已使用 artifact 不覆盖。无模型时也可以生成手工可复制提示词、导出制作表。

### 6.3 第一轮落地约束

人工制作卡编辑优先；先让现有正式 Shot 能改全部字段并追加不可变版本。新增 MD/JSON/CSV 分镜导出，按源范围、镜头编号、引用资产、完整提示词输出，CSV 做公式注入防护。P2-B2 的 Story Bible/分层分析可以并行设计，避免阻塞人工制作闭环。

## 7. 可靠的 Media Provider、任务和存储

### 7.1 Provider 契约

- 分离 ProviderType、Connection、ModelProfile、WorkflowProfile、PromptProfile；能力声明至少包含：text、image T2I/I2I、video T2V/I2V/first-last、audio TTS/music/SFX、edit/upscale。
- 每个模型给出 JSON Schema、必填输入、支持参考图数量、画幅、时长、分辨率、Seed、音轨、回调/取消/轮询能力；UI 按真实 capability 呈现。
- 第一媒体Provider采用ComfyUI原生POST /prompt；[ADR-010](../ADR-010-comfy-instances-and-board-boundary.md)冻结G2后多独立实例、auto/manual、后端授权，不开发Distributed专用提交。先保留单连接工作流，不安装或管理ComfyUI Workers。
- 第二媒体 Provider 待选择实际可用云端服务；不可硬编码平台私有未公开接口或依赖人工 cookie。

### 7.2 任务状态机与重复扣费防护

状态建议：`queued → preparing → submitting → submitted → running → collecting → archived`；异常：`retry_waiting`, `needs_reconciliation`, `failed`, `cancel_requested`, `cancelled`。接口对外使用 `completed` 时应意味着**产物已校验并归档**，而不是仅仅上游声称生成结束。

冻结请求快照、授权、引用版本和 Provider 配置版本，给出幂等 key，数据库事务认领、租约/心跳、分级重试；发送请求不确定时，**先轮询/查询上游，不自动重复提交**。同一外部输出以 `(provider_task_id, output_index)` 去重。

大量进度事件在内存/SSE 广播并节流写库；Web 刷新时从 DB 恢复真实状态。

### 7.3 StorageFacade

- V1 实现 Local、Mounted directory；以后 S3-compatible。
- SQLite 数据库必须本地磁盘，媒体文件可在 NAS 挂载路径，UI 不接触真实绝对路径。
- 上传流程：授权 → 限额/扩展名/MIME 检测 → 临时文件 → SHA256 + FFprobe/缩略图（适用时）→ 原子写入 → 数据库建立版本 → 提供 Range 鉴权预览。
- 读写必须防止 path traversal、symlink 逃逸、跨工作区猜 ID、未授权网络 URL、SSRF、下载炸弹。
- 媒体删除与项目回收站分离，已有版本的物理回收采用保留期、引用检查和审计；**不要让 Provider 的 `delete()` 直接暴露给普通用户或第三方技能**。
- 备份时必须包括 DB、媒体对象、Provider/Storage 配置及解密密钥，提供恢复验收；仅有 SQLite 快照不等于完整灾备。

## 8. 团队级生产协作与批量生成

- 任务管理：Target 可以为 Project/Unit/Shot/Asset/Take/Export，负责人、优先级、状态、截止日期、评论历史、角色权限。
- 审核：镜头卡审核和 Take 审核区分；已批准的 Take 只能显式替换，保留旧批准记录；退回需要原因；支持 Compare 两个版本。
- 批量任务：按镜头状态、资产完整度、模型能力、预算和审核通过条件过滤；显示确认清单与数量；失败仅重试失败项。
- 批次状态与单任务状态分离；取消一个批次必须明确哪些任务已经提交给供应商、哪些不能实际取消。
- 通知：先站内通知 + Web SSE；后续企业微信/飞书/邮件可作为插件。
- 制作看板：按项目/单元/负责人/状态可过滤；工作区管理员看全局，普通成员只看授权项目。
- 个人模式与团队模式共用同一内核，个人流程可以关闭审批门槛，不改变数据历史保护。

## 9. 无限画布与 Skill/Agent 可扩展架构

### 9.1 画布选型

`@xyflow/react` (React Flow)为底座。G1按[正式合同](../modules/CANVAS-G1-IMPLEMENTATION.md)只保存布局、便签和固定引用，业务仍由原API维护；连线统一注释关系，不执行生成或改卡。未来execution须另立合同，不因注释允许循环而跳过执行图校验。

画布按照 Project/Unit/Board 分区，支持一镜一板或章节看板；不要把 80 分钟电影的几千个镜头塞进同一张无限画布。与列表/故事板使用相同 Shot ID、AssetVersion ID，提供由正式镜头投射到 Board 与“将画布草案显式提交为正式镜头”的双向工作流。

### 9.2 Skill、Recipe、Agent 分开

- **CreativeSkill**：一个版本化、可验证输入输出的业务动作，例如人物提取、角色设计、场景规划、专业分镜、质检。
- **WorkflowRecipe**：有向无环/显式分支的可执行流程，引用若干 Skill / Provider 能力，例如“短剧从剧本到镜头”。
- **Agent**：能根据创作意图规划操作的调度助手；Agent 只能调用受控 Tool/Skill，不得直接写业务表。
- **UI Extension**：未来可安装的工作台组件/3D Previz，不与上述后端执行插件混为一谈。

所有扩展使用 `manifest: {id, version, sdkRange, permissions, capability, inputSchema, outputSchema}` 和资源配额。首版内置可信 Skill；**第三方上传脚本不在主 API 进程内任意执行**。未来采用隔离进程/容器、显式授权和安全审计。

### 9.3 学习开源项目时的许可证边界

借鉴 DramaClaw 的“结构化生产 + 自由画布共享资产”、LocalMiniDrama 的双视图、Huobao Canvas 的参考传播和类型化连线、shuohao-skills 的角色主锚点/站位、drama-skills 的“确认后投产”及连续性锁。**不直接复制 DramaClaw Elastic License 2.0、Huobao CC BY-NC-SA 4.0 受限代码**；MIT/Apache-2.0 复用也必须保留通知、检查第三方资产与依赖授权。

## 10. UI/UX 与视觉设计（团队级默认）

### 10.1 设计取向

专业深色电影工作台 + 降低学习负担 + 多工作区导航。保持统一 AppShell，但不同工作台可自由伸缩面板。强调“一个镜头在当前界面完成选角色/参考/提示词/模型/生成/审核”，减少跳转。

### 10.2 Design Tokens（先做 CSS 变量，不要求引入 Tailwind）

| Token | 深色值 | 用途 |
|---|---|---|
| `--bg-app` | `#101217` | 页面主背景 |
| `--bg-panel` | `#191D25` | 一级面板 |
| `--bg-raised` | `#252B36` | Hover、弹出层 |
| `--border` | `#323845` | 分割线与边框 |
| `--text-primary` | `#ECEFF5` | 主文字 |
| `--text-secondary` | `#9BA5B5` | 次文字 |
| `--accent` | `#7C9DFF` | 主要动作与选中 |
| `--success` | `#37BFA5` | 已批准／成功 |
| `--warning` | `#E5AF62` | 待审核／有风险 |
| `--danger` | `#E7777E` | 退回／失败 |

主题支持 Light/Dark；状态色只表达意义，不做装饰。文字、按钮、焦点态需要对比度测试。第三方插件不得覆盖全局基础 Tokens。

### 10.3 布局

- 顶部 56px：工作区/项目切换、搜索、通知、帐号。
- 左侧导航展开约 216px，可折叠为 64px，路由包含总览、剧本、资产、分镜、画布、任务、交付、设置。
- 中央响应式工作区，列表、卡片、导演视图/画布之间切换。
- 右侧 Inspector 约 320px，支持折叠和调整宽度；展示镜头、模型、角色版本、声音和审核信息。
- 底部任务抽屉默认收起，展开显示任务状态、队列、错误、重试。
- 手机端优先查看、审核、评论和任务处理；复杂画布编辑不作为手机端首版门禁。

### 10.4 页面及行为规范

- Project 首页提供创建向导（作品类型、叙事模式、画幅、风格可不选、导入/空白），系统编号自动生成。
- 资产中心优先展示角色三视图、声音配置、场景多角度、道具版本和“被哪些镜头使用”。
- 故事板提供镜头图片、时长、制作方法、负责人、状态，支持批量选择、筛选和审查。
- 画布采用引用节点而不是复制完整资产文件。连接分引用/执行/标注；边类型可视化区分。
- 生成面板先列出任务实际输入与费用估算（若可知），用户确认之后提交；刷新可恢复。
- 所有编辑遵守键盘可访问性、冲突输入保留、加载状态、长文本不丢、Esc 与焦点恢复。

## 11. 实施计划（阶段、依赖、验收、退出条件）

> 这是推荐顺序，Codex 应根据最新本地代码调整顺序；没有通过阶段门禁不得称已交付。每阶段必须运行相关回归，更新 IMPLEMENTATION-STATUS。

### Phase A — 当前仓库基线与文档统一

**目的**：把新需求和旧代码统一，避免多份文档冲突。

任务：`git status` 与最新 SHA；比较本文件；运行测试和备份；清理旧 Postgres/Redis 示例误导；现有 API、UI 和 Schema 清单；更新 `AGENTS.md`、实施状态、依赖表；建立兼容性测试。若发现本地未提交成果，禁止 `git reset --hard`、`git clean -fd`。

**验收**：本机类型检查、构建、Node 测试、E2E 全通过或精确列明失败；数据库备份可恢复；旧功能完全保留；最新实际状态清晰。

### Phase B — 正式制作卡、Prompt Compiler、文本交付（优先）

任务：完整手动镜头制作卡编辑；增量历史；导演/风格/Prompt Profile 版本；模型无关描述 + 编译器 + 完整可复制提示词；分镜 MD/JSON/CSV 及引用来源导出；无 API Key 离线可用。

**验收**：在一个 2 分钟旁白和一个多人对话分镜项目中，人工编辑全部镜头字段，编译提示词无漏风格/禁止项，旧版本可追溯，修改不会覆盖已审批内容，导出正确，无任何模型也可运行。

### Phase C — Storage、媒体资产与角色/场景/道具/声音

任务：Local Storage、上传、校验、Range、媒体预览、缩略图、FFprobe；媒体版本；资产库；三视图、场景多角度、道具、VoiceProfile；引用、使用影响查询；手工导入 Take。

**验收**：上传图片/视频/音频→预览→关联角色/镜头→新建版本→查询引用；越权、路径穿越、大文件、并发、网络中断、磁盘失败测试；原始素材从不就地覆盖。

### Phase D — Generation Provider 与第一条真实模型链路

任务：版本化 Provider/Model/Workflow 能力契约；媒体 Job + Worker + 任务状态；ComfyUI 标准 API 适配、真实工作流绑定、结果归档；手工补传；重试/调和；任务列表。

**验收**：先 Mock 后真实生成 1 张图片、1 个视频；输出都归档为 AssetVersion/Take；供应商返回完成但归档失败不会显示成功；断网/重启/重复请求不重复提交或已标记需核实。

### Phase E — 团队协作与批量生产

任务：Assignment、评论、审核状态、负责人、通知、批量生成筛选、配额/并发、项目看板、任务日志、负责人维度视图。

**验收**：至少 3 个角色在两个项目协作，编剧/导演/生成/审片权限不同；批量 10–20 镜头中部分故障仅重试失败；被撤权成员无法继续访问；审核版本有据可查。

### Phase F — VO、时间线、预演、导出交付

任务：声音素材来源/生成/导入、原生模型原声策略、保留既有顺序Timeline/Clip和可选FFmpeg预演、原件/CSV/JSON/说明交付包；SRT附件有明确时间码后接入。不新增基础多轨或字幕剪辑器。

**验收**：交付ZIP独立解包，逐镜头核对所选Take/批准版本、文件路径/字节及计划与实测时长。已有图片/视频预演和原声保留/静音回归；SRT及独立声音附件随对应模块验收，失败可恢复。专业剪辑软件工程交换兼容性另验。

### Phase G — 无限画布 + Skills/Recipes MVP

任务：React Flow 初版；角色/场景/素材/镜头/生成节点；类型化连接；画布持久化、版本与权限；核心内置 Skills：角色提取、角色设定、分镜规划、Prompt QA；可组合 Recipe；显式“草案→正式”提交。

**验收**：同一 Shot 在列表和画布更新后无数据漂移；同一角色资产被多个镜头复用，引用版本清晰；Agent/Skills 不绕过 RBAC 或审批；画布关闭后任务继续运行。

### Phase H — 自部署、灾备、规模验证与开源准备

任务：Windows 单机、Docker Linux 自部署；公开文档；环境变量与 Secret 管理；完整数据库+媒体+密钥备份恢复；安装向导；插件 SDK 示例；许可证审计；两种数据库备选路线的真实成本评估；批量长片压力测试。

**验收**：新机器按照 README 安装，创建工作区，导入一个项目，完成部分生产并导出；迁移备份到新环境可还原；无开发者机器私有绝对路径/密钥；外部开发者能用示例增加一个 Mock Provider 和内置型 Skill。

### 并行开发规则

- A 必须先完成；B 与 C 的数据结构设计可并行，但 C 依赖 Storage/资产鉴权；D 依赖 C 的归档能力；E 可与 D 后期并行，但不能在真实数据表结构未稳定前写假任务；F 依赖 Take/音频资产；G 可先做只读 prototype，但正式运行依赖 Production Core 和 D/E；H 的基础 CI/备份持续完善，正式开源门禁后置。
- 避免在一轮同时进行三个核心数据库重构；每次只做可验证的垂直切片。

## 12. 样例与验收矩阵

| 用例 | 验证重点 | 何时必须通过 |
|---|---|---|
| 《盘古》8–10 分钟旁白长视频 | 长文本分段、原文锁定、风格一致、静图+I2V、VO 音轨 | B–F |
| 3 分钟都市悬疑短剧 | 双人/多人对白、角色三视图和 Voice、场景站位与连续性 | B–G |
| 30 秒产品广告 | 不依赖完整剧本、手动镜头和产品参考图 | B–G |
| 2 个项目/3 个成员 | RBAC、任务分派、审核和越权防护 | E |
| 10–20 镜头混合批次 | 状态恢复、部分失败、批量重试、资产归档 | D–E |
| 80 分钟电影模拟数据 | 长篇分幕、镜头分页、分 Board、不一次性渲染所有内容 | G–H |

正式场景验收必须保留可重现的样例数据、脱敏日志、截图、导出文件及版本信息。不要在正式库插入自动化测试样例。测试仅可使用授权素材与模型。

## 13. 安全与权限门禁

- 项目/镜头/资产/工作区查询按数据库 scope 限定，资源 ID 不可作为授权依据。
- Secret 始终服务器端加密，API 只返回 `hasKey` 或 masked；日志和文件包不得携带明文密钥。
- 上传/下载/外部 Provider 结果防 SSRF、路径穿越、符号链接、超大资源、任意内部地址；批准的内网 ComfyUI 使用专门配置的可信端点策略。
- 所有写操作经权限、项目是否在回收站、版本冲突检查；批量生成在任务运行时重新检查权限和项目状态。
- 第三方 Skill/Plugin 只获得声明权限和受控 API，不直接访问数据库文件、私有目录、密钥和宿主进程。
- 支持审计关键操作：审批、撤权、覆盖引用、模型配置变化、批量提交、导出与物理清理。
- 开源发布前开展依赖许可证、SBOM、密钥扫描、测试凭据和历史提交审查。

## 14. 运维、可观测性与性能

- HTTP 请求关联 `requestId`，任务关联 `correlationId`；前端可复制错误代码，默认不暴露供应商秘密。
- 队列展示 pending/running/waiting/reconciliation/failed，支持异常查询和管理员告警。
- 索引工作区/项目/状态/更新时间；提供分页和缩略图，不在初始页面下载原始媒体。
- 同一块 SQLite 单机 Worker 可先满足团队使用，但写入短事务并节流进度；多主机和高并发需要实际压测后评估 PostgreSQL，不作未经测试的跨库承诺。
- 保留 FFmpeg 原始输出日志（脱敏和长度限制），媒体解码在隔离进程，限制 CPU/内存/执行超时。
- 基础 SLA 不在缺乏运行数据前承诺；通过 p95 延迟、错误率、归档成功率、任务恢复率决定后续优化。

## 15. Documentation as code：避免重复、过时任务文件

- `docs/MASTER-PLAN.md`：产品愿景与长期需求；技术栈过时段落注明已被现行 ADR 覆盖。
- `docs/IMPLEMENTATION-STATUS.md`：**唯一实时开发状态、下一个任务、验收数据**。
- `docs/architecture/REPOSITORY-CONTINUATION-PLAN.md`：本文件，当前仓库续开发架构与落地路线。
- 既有 `docs/ADR-001-stack.md` ～ `ADR-004-production-units.md`：保留既有有效决策。
- 新增 `docs/ADR-005-team-production-and-extension.md`：团队目标、领域扩展、无 Python 全量迁移、统一资产归属等确定事项。
- `AGENTS.md`：简短的执行入口：最新基线、测试、数据保护、禁止事项。
- 旧 `CODEX-START` / `CODEX-CONTINUE` 等文件若在本机存在，作为历史归档，不能并列充当新的执行计划。

文档冲突优先级建议：用户本轮明确要求 > 本地最新有效 ADR > 本文件的安全/兼容决策 > MASTER 长期目标 > 历史 ROADMAP。任何变更需留下 ADR/Changelog 记录。

## 16. Codex 第一条执行指令（直接复制）

> 请先完整阅读 `AGENTS.md`、`docs/MASTER-PLAN.md`、`docs/IMPLEMENTATION-STATUS.md`、`docs/ADR-001-stack.md` 至 `ADR-004-production-units.md`，以及 `docs/architecture/REPOSITORY-CONTINUATION-PLAN.md`。  
> 本仓库已经有真实业务代码和用户数据，**禁止重新初始化、替换后端为 FastAPI、重做已有数据库、删除历史迁移或无备份清理文件**。  
> 首先审计本地最新 Git 与远端差异，运行现有构建、自动化测试和数据库在线备份，输出“保留 / 整理 / 归档候选 / 新增”清单，核对本计划中基线 SHA 之后的代码变更。  
> 将 V1 目标调整为**团队级影视生产平台**，统一 Production Core，保留现有 NestJS/Drizzle/React/SQLite 与剧本→AI 草案→人工采纳链。  
> 对照本文件的 Phase A–H 自主规划，更新 `docs/IMPLEMENTATION-STATUS.md`。先执行 Phase A，再直接实施 Phase B 的第一项可验收功能：完整正式镜头卡编辑和版本回归；完成后继续 Prompt Compiler 与离线分镜导出。  
> 无需等待设计讨论的部分可自主实现，但涉及破坏性迁移、现有数据不可恢复、第三方受限源码合并、主技术栈更换、密钥外泄风险时必须先报告。  
> 每阶段提供测试命令/实际输出摘要、数据库迁移及备份记录、变更文件、UI 实际演示、风险与回滚方案。**不要只给计划，要持续完成下一项实际可用能力。**

## 17. 当前明确不做的事情

- 现在不转换所有 NestJS API 到 FastAPI。
- 不删旧 `episodes`、`shots`、剧本历史或重新编号。
- 不承诺 80 分钟电影一键自动成片、不强制所有镜头 5 秒。
- 不把所有剧本一次塞进同一个 LLM 请求。
- 不引入未确认许可的第三方影视项目完整源码。
- 不将 ComfyUI 多 Worker 管理功能再造一套。
- 不以“无限画布完成”作为开始制作第一条短片的前提。
- 不允许 AI 未经审核覆盖正式剧本、镜头、人物、Take。
- 不默认新用户拥有 NAS/独立 GPU；本地存储/人工导入/云 API 仍可用。
- 不在尚无真实多人/长片压力测试时宣称 PostgreSQL、CRDT、实时协作已经上线。

---

**本计划是设计和实施指导，不是已经执行的改动。请让 Codex 首先在本地最新代码上复核、备份与测试，再增量实施。**
