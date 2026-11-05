# Pullet Studio V1.0 — 团队级影视生产平台：模块实施蓝图与参考源码地图

> 2026-11-05工作规格修订：[ADR-009](../ADR-009-production-and-postproduction-handoff.md)确定生产工作台＋创作画布、轻量预演与专业后期交接边界。保留既有版本、预览及FFmpeg，不开发内置专业剪辑器；声音素材/SRT交付按实际来源另包，OTIO/FCPXML待逐软件验证。以下相关段落已同步收紧，不改变原技术栈或重建既有表。

> **规格版本**：1.1（2026-11-05）
> **目标读者**：桌面 Codex、未来团队开发者、架构评审
> **基准仓库**：[XMJGame/PulletStudio](https://github.com/XMJGame/PulletStudio) `main`；读取时树 SHA `9c0ad77d5bc23ca2ee0e0f24737ebacac303dcec`。
> **优先级**：这是对 [现有仓库续开发计划](REPOSITORY-CONTINUATION-PLAN.md) 的 **技术细化附录**。现有代码与用户数据安全优先；`AGENTS.md`、现有 ADR、`IMPLEMENTATION-STATUS.md` 的已落地决定不得被未经评估的旧规划覆盖。
> **证据界限**：项目现状来自仓库文件和其报告；未重新在用户机器执行测试、未接入真实 ComfyUI；外部项目功能来自其 README/许可证及公开源码说明，不能理解为已验证可直接移植。

## 0. TL;DR：最终冻结的技术方案

工作流配置补充：G2-A先复用GenerationService及已有导入/绑定，补集中入口/只读技术图，再增量实现Schema/依赖/修订；G2-B接正式画布Job/结果/Take，G2-C做独立实例。参考hero8152的[能力对照](HERO-INFINITE-CANVAS-REVIEW.md)严格区分已见代码/README宣称及授权边界，不复制源码、不新建Generation/Storage/权限事实源。

G1实施修订：[正式画布合同](../modules/CANVAS-G1-IMPLEMENTATION.md)使用boards/board_revisions、固定卡/实体/媒体引用与原RBAC/CAS，连线只注释，不自动改Shot。原G1–G5命名仅作历史需求映射；当前顺序G1→G2现有生成/候选闭环→ComfyUI多独立实例→团队/批次/交付/部署。依据[ADR-010](../ADR-010-comfy-instances-and-board-boundary.md)，不为G1提前实现执行DAG、Skills或调度。

- **主技术栈**：保留现有 NestJS 11 + TypeScript + React 19/Vite + Drizzle + better-sqlite3，不整体迁移 FastAPI。
- **部署**：先单实例 API + SQLite 本机盘 + 同机独立 Worker；媒体可存本地盘/NAS，后续 S3；未来多实例和 PostgreSQL 是独立迁移项目。
- **业务中心**：一个 Production Core 维护剧本、制作层级、角色、场景、道具、镜头、Take、版本、审核。画布和 Agent 都是客户端/调用者，**不是另一个事实源**。
- **创作体验**：剧本/结构化故事板/无限画布/资产中心/任务中心/简易时间线多视图共存。
- **扩展**：区分 `Provider Adapter`、`Skill`、`Recipe`、`UI Extension`、`Storage Adapter`，统一能力声明、Schema、版本和权限。第一版仅允许可信内置运行；第三方不受信任执行另行沙箱化。
- **分步交付**：①镜头卡与提示词文本闭环 → ②资产/媒体导入 → ③生成与 Take → ④团队批量/审批 → ⑤声音/预演 → ⑥画布/Skills → ⑦部署/开源 SDK。
- **数据保护**：历史迁移、UUID、编号、剧本不可变版本、审核采纳快照、SQLite WAL 备份、RBAC 和已实现 Worker 机制全部保留。

## 1. 参考项目地图（逐项明确看哪里、借鉴什么、不照搬什么）

> 本节的仓库名称与链接用于 **Codex 定向源码调研**，不是拉下来就依赖。合并代码前必须核查实际 `LICENSE`、子目录/素材许可及依赖许可；对 CC BY-NC-SA 或 Elastic License 2.0 的源码，仅做设计研究，默认 **不复制代码**。

| 参考源 | 链接 | 重点研究代码/功能 | 落地到 Pullet Studio | 不照搬 |
|---|---|---|---|---|
| DramaClaw | https://github.com/dramaclaw/dramaclaw | XiaHua 画布 + XiaJi/Series 流水线共享资产、Xia Director、工作流与系列互相投射 | 双视图共享单一业务实体、资产从探索区提交到正式镜头、Agent 可操作同一服务 | 整套后端或其 Elastic-2.0 代码、闭测 3D 功能 |
| Huobao Canvas | https://github.com/chatfire-AI/huobao-canvas | 节点输入自动注入、类型化连接、Prompt Dock、不同模型适配、服务端异步队列 | `GraphEdge` 语义、引用素材 `@` 选择器、Capability UI、可靠任务状态 | CC BY-NC-SA 源码、前端存 API Key 方案 |
| Huobao Drama | https://github.com/chatfire-AI/huobao-drama | 剧本→人物/场景→分镜→生成的生产步骤；可编辑 AI 技能 | 结构化生产工作台、分阶段审核与模板 | CC BY-NC-SA 源码、把某个模型写死 |
| LocalMiniDrama | https://github.com/xuanyustudio/LocalMiniDrama | 列表和 Vue Flow 画布**同源数据**、流程分组重跑、从剧本到分镜、SRT/FFmpeg | 同一 Shot 可列表/画布编辑、分镜批次与失败项重试 | Vue/Express 整体替换当前 React/NestJS |
| StoryAI 3D 导演台 | https://github.com/jiguang132/storyai-3d-director-desk | R3F/Three.js 机位、人物走位、镜头视角、模型/全景图导入与截图 | 后续 `PrevizAsset` / 3D 预演插槽、机位截图回写素材库 | 首版强制 3D、重型运行时依赖 |
| shuohao-skills | https://github.com/eternityspring/shuohao-skills | `novel-outline`、`novel-characters`、`character-refs`、`novel-art`、`novel-staging`、`novel-storyboard` 的阶段产物与检查 | 主锚点角色视图、场景 Bible、站位与可机检质量门禁 | 将全部短剧规则硬编码为通用标准 |
| 漫剧老李 | https://github.com/lixiaoxiao9888-create/manju-laoli-skill | 总控 + 专项技能、人物站位/轴线、文戏/武戏、模型分支、提示词检查 | Skill 分类、Director Profile、Provider prompt transform、校验规则注册表 | 将某型号/版本的 Prompt 当永久标准 |
| ZenStory drama-skills | https://github.com/zenstory-ai/drama-skills | 剧本/设定/分镜/图片词/视频词分层文件；锁定跨镜约束；投产前逐批确认 | 可读可导出的 Artifact、ContinuityLock、人工确认与可重放审计 | 取消 UI 与数据库，只靠 Markdown 存全部团队状态 |
| React Flow / xyflow | https://reactflow.dev/ 与 https://github.com/xyflow/xyflow | 自定义 React 节点、类型化 Handles、连接检查、视口与序列化 | 首版画布底座 `@xyflow/react`，自研影视节点 | 以 React Flow JSON 代替业务数据库 |
| Rete.js | https://retejs.org/ | 计算图/插件式执行 | 作为技术备选参考 | 首版换上第二套画布引擎 |
| tldraw | https://tldraw.dev/ | 空间白板/图形编辑 | 未来研究自由白板模式 | 未经许可将 SDK 作为商业部署依赖 |

**许可证核查概况（核查时点 2026-11-05）**：DramaClaw 声明 Elastic License 2.0，Huobao Drama/Canvas 仓库许可为 CC BY-NC-SA 4.0，LocalMiniDrama 与 3D 导演台为 MIT，shuohao-skills 为 Apache-2.0，漫剧老李与 ZenStory drama-skills 为 MIT。许可可能变化，每次复制/依赖前以具体版本文件为准。

**对 Codex 的参考源码阅读顺序**：
1. LocalMiniDrama：先看列表/画布是否引用同一 Shot；写出我们需要的最小同步合同。
2. DramaClaw：再看探索画布向正式系列资产提交（commit/promote）的边界；写出候选资产→正式资产的转换策略。
3. shuohao / ZenStory：从 Skill 输出抽取 JSON Schema、连续性与人工审核机制。
4. Huobao Canvas：只研究参考输入传播和类型化边规则，重新实现。
5. 3D 导演台：记录后续 Preview 插槽，不阻塞第一条影片链路。

## 2. 基准仓库：按现有文件决定保留、演进、整理

### 2.1 已经存在，必须保留

| 仓库真实路径 | 已有能力 | 本次演进方向 |
|---|---|---|
| `apps/api/src/auth/*` | 初始化、登录/退出、会话、密码保护 | 增加生产部署验证；不重置账户/会话 |
| `apps/api/src/production/*` | Workspaces/Projects/Members/Units/Shots/权限 | 新建 `Assignments/Reviews` 子模块；禁止重编号 |
| `apps/api/src/scripts/*` | 版本、原文、哈希、锁定/来源证据 | 增强导入类型、Span 与版本映射；不覆盖原文 |
| `apps/api/src/analysis/*` | Text Worker、来源引用的 Proposal、人工审核采纳、ShotCard 历史 | Story Bible / 分层解析作为附加链路；旧 Proposal 不改变 |
| `apps/api/src/providers/text*`, `safe-text-http.ts`, `provider-secrets.ts` | Text 接口、加密、端点约束 | 与媒体 Provider 共享安全基础，不共享不适用的传输协议 |
| `apps/api/src/db/schema.ts`, `apps/api/drizzle/*` | 既有 24 张表/14 次迁移（仓库记录） | 只新增迁移，禁止删除历史和物理重命名 |
| `apps/web/src/components/*` | 剧本、结构、草案、镜头卡、成员等页面 | 迁移进 AppShell/路由，而不是重写 |
| `apps/api/test/*`, `tests/e2e/*` | API/Edge 回归 | 每一阶段持续增加，不许退化 |
| `packages/contracts/src/provider.ts`, `storage.ts` | 仅设计期媒体接口草案 | 保留路径但逐项演进为实际版本化契约 |

### 2.2 需要整理但暂不删除

- `apps/api/src/app.module.ts`：当前集中注册依赖；逐个拆为领域模块，任何抽取都先保证 API 路由和权限行为不变。
- `apps/web/src/main.tsx`：逐步引入 `AppShell`、路由和工作台页面；旧页面在每次迁移后必须跑 E2E。
- `apps/web/src/style.css`：拆成 `tokens.css` + `layout.css` + `components.css`；逐步改 CSS 变量，不强制换 Tailwind。
- `apps/api/src/db/schema.ts`：规模扩大后按业务领域拆**代码文件**，物理表/外键不因代码拆分而变化。
- `docs/MASTER-PLAN.md`：业务需求仍有效；FastAPI 主后端建议已被 `docs/ADR-001-stack.md` 覆盖，需标注冲突优先级。
- `docs/05-DEVELOPMENT.md`/`04-ROADMAP.md`：历史验收记录保留；唯一实时进度为 `IMPLEMENTATION-STATUS.md`。

### 2.3 退役/移除候选（严格有条件）

- `infra/compose.dev.yml`：当前文件启动 PostgreSQL/Redis，**与现运行的 SQLite 不一致**。先搜索脚本/CI/文档引用，补充适配现有架构的单实例 Compose 后，若证实无依赖，才将旧示例迁到 `infra/legacy/` 或从默认路径删除；禁止误删正在使用的部署配置。
- `examples/comfyui-binding.example.json`：保留作为**示例**，不要把特定工作流节点 ID 当全局契约；后续换成版本化 Capability+BindingSchema 实例。
- `CODEX-START.md` 这类过时阶段任务（如本地存在）：标记 `superseded` 后归档；不可删除 ADR、真实迁移、历史审计或数据备份。
- **绝不移除**：原剧本来源、不可变审核记录、曾使用的生成参数、已批准资产版本、业务 UUID、历史 SQL 迁移。

## 3. 业务边界与项目级数据模型

### 3.1 事实源与业务对象

```text
Workspace
 ├─ Members / Roles / Invites / Audit
 └─ Project
     ├─ ProductionUnit (复用现有 episodes，允许树形)
     ├─ Script → ScriptRevision → ScriptSource → ScriptSpan
     ├─ StoryBible → BibleRevision
     ├─ Character / Environment / Prop / VoiceIdentity (AssetEntity)
     │    └─ AssetEntityRevision → MediaAssetVersion(s)
     ├─ Shot → ShotCardRevision → SourceSpanLink
     │    ├─ ShotAssetBinding (冻结实体版本+用途)
     │    ├─ PromptArtifact (不可变编译结果)
     │    ├─ GenerationJob → JobOutput → MediaAssetVersion
     │    ├─ Take → TakeReview → SelectedTake
     │    └─ Assignment / Comment / StatusHistory
     ├─ Board → BoardRevision → Nodes / Edges (引用业务 ID)
     └─ StoryboardPreview → 已有TimelineRevision / 顺序Clip → 可选Animatic / Delivery
```

**最关键的拆分**：
- `AssetEntity` 是角色/场景/道具这样的**语义对象**，不等于一个文件；`MediaAssetVersion` 才是某个图片/视频/音频物理文件与其元数据。
- `Shot` 是正式镜头身份；`ShotCardRevision` 是镜头描述历史；`Take` 是候选产物；`SelectedTake` 是当前选中版本关系。
- `BoardNode` 只保存布局、外观和对 `Shot/AssetEntity/Job/PromptArtifact` 的引用；**不能复制另一套业务真相**。
- 语义实体可以有不同造型与状态，但引用某镜头时固定 `revisionId` 和使用条件，不能随着“角色最新版本”变化而悄悄修改已批准镜头。

### 3.2 通用影视层级

已经实现的 `episode/act/chapter/sequence/scene/section` 继续作为 ProductionUnit 类型，不建第二套 Tree。项目直属镜头遵循现有内部 `project_root` 桥接方案；不暴露内部根行。短视频无需强行创建分集，长电影可按幕/场次拆层。

### 3.3 新增表的建议字段（分阶段落地，避免一次创建所有表）

| 表/实体 | 最小字段 | 关键约束 |
|---|---|---|
| `asset_entities` | id,workspace_id,project_id?,kind,name,description,current_revision_id?,created_by,deleted_at | `kind`=character/environment/prop/voice/other；按工作区隔离 |
| `asset_entity_revisions` | id,entity_id,revision_no,attributes_json,created_by,created_at | 追加不可变；复用正式审计模式 |
| `media_objects` | id,workspace_id,sha256,mime,size_bytes,media_type,created_by,created_at | 逻辑对象 ID，不把绝对路径暴露给浏览器 |
| `media_object_versions` | id,media_object_id,storage_connection_id,object_key,sha256,metadata_json,created_at | 物理对象不可覆盖；校验大小/哈希 |
| `entity_media_bindings` | entity_revision_id,media_version_id,role,sort_index | role=front/side/back/closeup/overview/night/ref_voice 等 |
| `shot_asset_bindings` | shot_id,shot_card_revision_id,entity_revision_id,role,context_json | 绑定固定版本；保存时校验 workspace/project 权限 |
| `prompt_profiles` | id,scope,kind,revision_no,template,config_json | 不允许覆盖已用历史版本 |
| `prompt_artifacts` | id,shot_id,card_revision_id,compiler_version,profile_revision_id,rendered_json,created_at | 一次编译冻结全部输入版本 |
| `generation_jobs` | id,workspace_id,project_id,shot_id?,provider_connection_id,model_profile_id,request_snapshot,state,idempotency_key,provider_task_id?,lease...,timestamps | 同工作区幂等唯一、状态机受控 |
| `job_outputs` | id,job_id,output_index,media_object_version_id?,status | 唯一 `(job_id, output_index)` |
| `takes` | id,shot_id,media_version_id,job_id?,take_no,created_by,status | 资产来源和生成来源完整 |
| `review_events` | id,workspace_id,project_id,target_type,target_id,action,actor_id,reason,created_at | 事件不可变，批准的输入版本可追踪 |
| `production_tasks` | id,project_id,target_type,target_id,assignee_id?,status,priority,due_at?,version | RBAC 与被分配任务权限分离 |
| `boards` / `board_revisions` | id,project_id,scope_unit_id?,name,revision_no,nodes_json,edges_json,version | 布局乐观锁，服务端校验引用与边类型 |
| `timeline_revisions`/`timeline_clips` | id,project_id,revision_no,status,track,... | 引用 Take/MediaVersion，时间采用整数 tick/ms |

**迁移策略**：逐阶段扩表，先创建 nullable 的桥接引用并回填→验证外键、唯一索引→在新写链路使用→稳定后才逐步收紧；每次迁移先执行在线备份、独立新 DB 验收、旧数据库兼容和回滚演练。若 `schema.ts` 已有同名表，**复用而非新建**。物理命名只是建议，Codex 以实际 Drizzle 命名规范为准。

### 3.4 角色、场景、道具、声音设计

**角色 Character**：基础设定 + 主锚点图；正面、侧面、背面、面部特写为独立媒体角色（不是拼图唯一源）；服装/年龄/情绪是 `LookVariant` 与 `State`；声音独立 `VoiceIdentity`，角色引用其版本和语言，不直接存 Provider 私有 voice ID 于通用角色实体。

**场景 Environment**：`location/layout/space_relation` + 正面广角、反打、顶视、空场底板、昼夜/天气/灯光状态；不强制“三视图”，因为影视场景需要空间连续性。

**道具 Prop**：形体尺度、材质、多视角、当前状态、与人物交互历史，例如斧头的完好/破损、持有人变化。

**声音 VoiceIdentity**：语言、音色描述、供应商模型引用、授权/同意信息（如适用）、音频样本与状态版本，声音资产的访问权限独立于普通图像；禁止隐式上传真实人物声纹到外部模型。

**连续性**：`ContinuityConstraint` 声明角色身份、服装、站位、持物、场景状态、灯光和跨镜先后关系；`ShotAssetBinding` 固定引用。在提示词编译前校验必要角色参考/场景视图是否齐全，不满足条件则可出草稿但阻止“生产就绪”。

## 4. 模块详解 A：镜头制作卡、Prompt Compiler 与导出（最先实现）

### 4.1 现有落点

- 现有：`analysis/analysis-contract.ts` 的 `shotDraftSchema`、`production/shot-cards.ts`、`shot_card_revisions` 与 `ProposalReview`。
- 增量新增建议：`apps/api/src/prompt/{prompt.module,profiles.service,compiler.service,prompt.controller}.ts`、`apps/web/src/features/prompt/*`。

### 4.2 流程

1. 从现有正式 `ShotCardRevision` 获取已保存镜头，允许**手工创建/编辑完整卡**（不要求必须经 AI 草案）。
2. 收集 ScriptSpan、剧本修订、DirectorProfile、项目风格、固定版本角色/场景/道具、声音策略。
3. 生成中立 `ShotIntent`（主题、场景、人物、构图、动作、摄像机、光照、时长、音频和风险）；缺失数据按强制/可选分类。
4. `PromptProfile` 添加统一风格、具体镜头细节、负面约束；`ProviderPromptTransformer` 根据目标模型 Capability/Schema 转换为完整、可复制的 prompt 与配置。不能把某个模型参数写入 `Shot`。
5. 保存 `PromptArtifact` 不可变快照，记录所有输入版本/编译器版本/操作者/时间；改图或改角色时标记新编译**stale**，历史 Artifact 不变。
6. 导出 Markdown/JSON/CSV，长文档分页/流式；CSV 需处理 `= + - @` 公式注入；文本导出不需要配置云模型。

### 4.3 推荐 TypeScript 契约

```ts
interface ShotIntent {
  shotId: string;
  shotCardRevisionId: string;
  visual: { subject: string; composition?: string; camera?: string; lighting?: string; action?: string };
  audio: { narration?: string; dialogue?: string[]; ambiance?: string; generatedAudioPolicy?: 'keep'|'mute'|'inspect' };
  references: Array<{ entityRevisionId?: string; mediaVersionId?: string; role: string }>;
  constraints: { positive: string[]; negative: string[]; continuityLocks: string[] };
}
interface PromptArtifact {
  id: string; capability: string; modelProfileId?: string;
  positive: string; negative?: string; options: Record<string,unknown>;
  inputRevisions: Record<string,string>; warnings: string[];
  compilerVersion: string;
}
```

### 4.4 API 草案

- `GET /api/v1/shots/:id/card` 沿用现有读接口；新增完整卡 `PATCH`，参数 `expectedVersion`，原文源不允许由客户端伪造。
- `POST /api/v1/shots/:id/prompts/compile`：可指定 `profileRevisionId`/`modelProfileId`；编译可预览后保存。默认不创建付费任务。
- `GET /api/v1/shots/:id/prompts`：分页查询历史；`GET .../:artifactId` 下载 JSON 与可复制文本。
- `POST /api/v1/projects/:id/storyboard-exports`：按范围导出 MD/JSON/CSV，异步任务可扩展。

### 4.5 验收与失败标准

- 无模型连接也能创建/编辑正式镜头卡与完整提示词并导出。
- 一个镜头同时引用角色、场景和道具；输出包含视觉风格、镜头动作和明确声音处理；没有参考图不凭空编造引用。
- 双人冲突 409，不覆盖本地草稿；旧 PromptArtifact 始终可读。
- 将《盘古》与都市对白、广告三个不同入口用于回归；提示词中不存在写死“盘古”/“神话”。

## 5. 模块 B：StorageFacade、媒体资产和安全导入

### 5.1 模块位置

`apps/api/src/storage/`：`storage.types.ts`, `storage-registry.ts`, `local.adapter.ts`, `mounted.adapter.ts`, `delivery.service.ts`；`apps/api/src/assets/`：`assets.service.ts`, `uploads.service.ts`, `metadata.service.ts`, `assets.controller.ts`；共享契约继续用 `packages/contracts/src/storage.ts` 并加版本。

### 5.2 写入过程（两阶段，禁止数据库先宣称成功）

1. 认证/租户权限、文件类型、配额和用途校验；创建 `UploadSession`、随机临时对象 key。外部上传使用有界流；不把完整视频读入内存。
2. 只允许写入服务器指定的物理根目录，路径经规范化 + symlink/realpath 校验，拒绝 `..`、绝对路径、特殊文件和越界；媒体真实类型需探测，不仅信扩展名。
3. 写入 staging 临时文件；同时计算 SHA256 和大小，限制最大文件、速率、并发、超时；超限删除 staging。
4. `fsync`/关闭后将 staging 原子 rename 到内容地址或 UUID 路径（同文件系统）；如果跨设备，必须 copy→校验→commit，不谎称 rename 原子性。
5. 获取媒体信息（FFprobe，超时与输出限制），图片缩略图/视频 poster 以独立衍生对象记录；源文件不可变。
6. 数据库事务写 `MediaObjectVersion` 和逻辑引用；如果 SQL 失败，文件进入 orphan 清理清单，不自动删其他引用。
7. 读文件必须再次授权 workspace/project；支持 HTTP Range、MIME、安全 Content-Disposition；S3 后期可用短时签名 URL。

### 5.3 Storage Adapter 契约建议

```ts
interface StorageAdapter {
  readonly kind: string;
  putStaged(input: AsyncIterable<Uint8Array>, requestedKey: string, limits: UploadLimits): Promise<StoredObject>;
  stat(key: string): Promise<StoredObject | null>;
  openRead(key: string, range?: {start: number; end?: number}): Promise<AsyncIterable<Uint8Array>>;
  copyVerified(sourceKey: string, targetKey: string, expectedSha256: string): Promise<StoredObject>;
  // 物理删除仅由有审计/引用检查的 GC 服务调用，不作为普通权限暴露
}
```

**位置约束**：SQLite 文件必须位于 API 主机本地持久化盘；**不能放 NAS 网络盘**。媒体可选 mounted NAS 目录，且不能默认假设用户都有 NAS。Local 首先实现，Mounted 其次，S3 后续。Provider/Storage 凭据存服务端，前端只获掩码配置。

### 5.4 测试

多 GB 大视频流式输入、断点/超时、MIME 伪装、路径穿越、符号链接、同名文件、跨租户下载、非法 Range、磁盘写满、任务重启、数据库提交失败、原视频 SHA256 变化检测、EXIF/元信息脱敏策略。

## 6. 模块 C：资产 Bible 与版本引用

### 6.1 为什么语义资产和媒体文件分开

一个角色可以有“正面主锚点、侧面、背面、脸部、服装 A、服装 B、声音”多个独立文件。角色身份和视觉设定不能绑死到任何某一张图片。相同媒体文件还可能用于不同镜头。

### 6.2 创建/修改行为

- `POST /projects/:id/entities` 创建角色/场景/道具/声音身份草稿；保存后得到稳定实体 ID。
- `POST /entities/:id/revisions` 每次修改创建新 Revision。提交前按资产类型做 Zod 校验。
- `POST /entities/:id/media-bindings` 将版本化 media 与 `front`, `side`, `back`, `closeup`, `overview`, `floorplan`, `voice_sample` 等语义位置关联。
- 角色三视图产生方式：优先建立单张审核过的正面主锚图，再按需派生其他视角；失败或局部重绘不能自动更换全角色身份。
- 镜头 `ShotAssetBinding` 引用指定 EntityRevision；要更新镜头引用必须形成新的卡版本，批准旧镜头保持不变。
- 跨项目共享只支持同工作区授权范围；跨工作区复制必须创建新逻辑引用并记录源版权/许可，不能偷偷开放。

### 6.3 API/校验

- `GET /api/v1/projects/:id/entities?kind=character`, `POST /api/v1/projects/:id/entities`
- `GET /api/v1/entities/:id/revisions`, `POST /api/v1/entities/:id/revisions`
- `POST /api/v1/shots/:id/asset-bindings`（expectedShotCardVersion）
- `GET /api/v1/entities/:id/impacted-shots`：资产修订变化时展示影响镜头，不批量自动重生。

### 6.4 团队规则

美术可以编辑草稿资产；导演/审核者批准某一版本；生成工作者只能引用批准版本（允许项目配置例外）。审计必须记录审批人、具体版本、理由。Voices 的权限和外部上传告知需比普通图片严格。

## 7. 模块 D：Generation Provider 与可靠任务执行

### 7.1 复用现有 Worker 经验，不复制其一切细节

现有 `text-analysis-worker.ts` 已有队列领取、租约、心跳、限流/等待和 `needs_reconciliation`；新媒体任务独立表/Worker，但重用可靠性原则和可观测性设施。不能用文本任务 `completed` 直接代表媒体归档。

### 7.2 能力矩阵与模型资料

`Connection`=端点+鉴权；`ModelProfile`=模型能力+参数 JSON Schema；`WorkflowProfile`=ComfyUI API 图及绑定版本；`GenerationJob`=一次冻结的请求与上游关联。

`Capability` 建议：`text.structured`, `image.text_to_image`, `image.edit`, `video.text_to_video`, `video.image_to_video`, `video.first_last_frame`, `video.reference_to_video`, `audio.tts`, `audio.music`, `audio.sfx`, `media.upscale`。每个模型声明允许的输入数量、时长范围、尺寸、负面词、声音生成、参考图、取消等，UI 根据能力渲染，不能让 unsupported 模型强行执行。

```ts
interface MediaProvider {
  type: string;
  describeCapabilities(): Promise<ProviderCapabilities>;
  submit(request: FrozenGenerationRequest): Promise<{providerTaskId?: string; initialState: 'submitted'|'completed'|'unknown'}>;
  reconcile(snapshot: FrozenGenerationRequest, providerTaskId?: string): Promise<RemoteJobObservation>;
  getResults(observation: RemoteJobObservation): Promise<ResultDescriptor[]>;
  cancel?(job: ProviderJobRef): Promise<'confirmed'|'unsupported'|'uncertain'>;
}
```

### 7.3 严格状态机

```text
queued → preparing → submitting → submitted → running → fetching → verifying → archiving → completed
                            ↘ needs_reconciliation
queued/preparing → canceled
any valid state → retry_waiting / failed (受错误类型和重试预算限制)
```

必须区分**远端生成完成**和**本地资产完成归档**。`completed` 只能在：期望的输出已经校验哈希、媒体资产记录已持久化、按请求绑定到 Shot/Take，且确认事务成功后出现。

**防重复扣费**：用 `Idempotency-Key` 防本地重复；如果超时发生在提交临界区且供应商缺幂等键，标记 `needs_reconciliation` 并通知人工核实；不可自动重发。能通过远端 task ID 查询的先查再恢复。

### 7.4 ComfyUI 的接法

- 普通模式：API workflow JSON + 输入绑定 Schema → `POST /prompt` → 通过历史/WS 查结果 → `/view` 或受控文件取回 → Studio Storage 归档。
- V1不接Distributed专用API。G2后支持多个原生独立实例：后端维护能力/健康/容量/队列及工作区授权，默认auto、高级manual失败不静默换机；地址/密钥仅在后端，Job冻结实际实例及外部Prompt ID。当前单连接工作流保持兼容，不声称调度已实现。
- 不强制修改或安装已有 ComfyUI；连接只是用户填入的受信端点；模型盘符、机器 IP、ComfyUI 节点 ID 不写死在业务库。
- 验收先用 Mock，再用用户手头实际工作流 JSON 做 1 个图片+1 个视频，记录输入绑定、输出归档与失败重试证据。

### 7.5 API

- `POST /api/v1/provider-connections`, `POST /api/v1/provider-connections/:id/test`
- `GET /api/v1/model-profiles?capability=...`, `POST /api/v1/workflow-profiles/:id/validate`
- `POST /api/v1/generation-jobs`（冻结 `PromptArtifact`、引用的媒体版本、Provider Profile，用户确认费用后执行）
- `GET /api/v1/generation-jobs/:id`, `POST .../:id/retry`, `POST .../:id/reconcile`, `POST .../:id/cancel`

### 7.6 测试

同一键并发提交、Worker 中断及重启、429/5xx/断网、请求已发送但响应丢失、远端取消不支持、下载短链接过期、输出校验失败、归档部分失败、跨工作区 jobId 访问、权限撤销后禁止新提交、成本预算耗尽。

## 8. 模块 E：Take、审核、分工和批量生产

### 8.1 审核对象与状态

`Take` 是 Shot 下某个视频/图像版本，不是媒体文件实体本身。建议 `draft → submitted → in_review → approved/rejected → superseded`；批准动作记录**审核时的确切 Take、AssetVersion、PromptArtifact 版本**。旧批准记录追加不可变，换选片必须新建决策事件。

### 8.2 分工

`ProductionTask` 建议字段：workspaceId、projectId、targetKind/ID、assigneeId、reviewerId、priority、dueAt、status、revision、createdBy。指派可有多个角色参与但只能有一个当前责任人（可后续扩展多人子任务）。**Assignment 不授予数据权限**，必须同时通过现有 RBAC。

### 8.3 批量生成前的 Dry Run

预检整个批次：镜头是否已有批准参考、PromptArtifact 是否新鲜、模型是否支持比例/时长/参考数量、项目预算是否允许、是否存在重复同内容请求；先列出：`ready / blocked / stale / missing_asset / unsupported / awaiting_review`。用户确认**选中的** ready 项后，生成不可变 `BatchManifest` 再排队。

失败重试仅重试指定 Job，不应默认重新分析剧本或重新生成角色。批次进度来自 DB 状态，不只依赖 SSE。

### 8.4 评论与通知

评论绑定实体及版本、时间码（如适用），支持@人员但解析文本不应自动提权。通知先 DB + SSE，刷新后仍可查询，离线推送后续。被移出项目后历史署名保留，但不再可访问项目详情。

### 8.5 API

- `POST /api/v1/production-tasks`, `PATCH /api/v1/production-tasks/:id`（expectedVersion）
- `POST /api/v1/takes/:id/submit-review`, `POST /api/v1/takes/:id/approve`, `POST /api/v1/takes/:id/reject`
- `POST /api/v1/generation-batches/preview`, `POST /api/v1/generation-batches`（只接收服务端签发的预检快照和确认）
- `GET /api/v1/projects/:id/production-dashboard`

### 8.6 验收

3 个不同角色账号操作 2 个项目至少 20 个镜头；成员撤权即刻生效，两个审核者冲突只接受一次明确有效决策；批次只执行 ready 的镜头；失败项重试不改动已批准结果。

## 9. 模块 F：声音策略、时间线、预演与项目交付

### 9.1 解决即梦生成视频自带音的问题

音频分离建模：`VoiceOver`、`Dialogue`、`Ambience`、`SFX`、`BGM`、`GeneratedSourceAudio`。镜头属性有 `sourceAudioPolicy = keep | mute | inspect | replace`；导出时控制音轨而非破坏源视频。素材原始音轨元信息需 FFprobe 检测，是否携音轨不能用假定。

### 9.2 轻量预演数据

- 复用已实现 `TimelineRevision` + 顺序 `Clip`，引用冻结的Take/媒体版本；整数毫秒及帧对齐规则保留，用于故事板预演，不新增多轨编辑模型。
- 镜头顺序、计划时长、素材实测时长及原声keep/mute分别表达。停止音量轨道、淡入淡出、转场、关键帧、调色、特效合成与专业混音扩展；声音/字幕素材来源和交付另按业务需要设计。
- 通过 FFprobe 验证视频分辨率、FPS、时长、音轨；FFmpeg 子进程限制并发、超时、目录与参数，不能拼接用户原始 shell 字符串。
- ExportJob 成功条件为输出文件存在、哈希/媒体校验通过、资产归档完成并可播放；单纯 FFmpeg 进程 0 退出不算全部成功。

### 9.3 Export 与可移植性

优先标准原件、分镜Markdown/JSON/CSV、镜头清单与制作说明、带manifest的交付ZIP；MP4预演可选。声音附件与SRT需明确角色/版本/时间码/权限后接入，不编造字幕或空文件。manifest记录schemaVersion、项目/资产/Take/审核版本、相对路径和文件校验。交付ZIP与完整项目重导入分别设计，后者只能创建新项目/映射ID。OTIO/FCPXML后置并按软件和版本验证。

### 9.4 验收

用样例选片验证顺序/计划与实测时长区分、媒体预览及可选低清预演。交付包独立解压，核对每个镜头/Take对应路径、字节、版本与审核证据；音频/SRT在相应附件模块完成后另验，完整项目重导入保留独立门禁，不把专业剪辑工程兼容性冒充已通过。

## 10. 模块 G：无限画布 + Skills/Recipes/Agent

### 10.1 画布：React Flow，四个关键边界

1. `BoardRevision` 保存节点位置、尺寸、折叠状态、连线和视口，不把角色描述、镜头主数据复制在节点 JSON 里。
2. `NodeRef = {entityKind, entityId, revisionId?}`。图像与视频节点可以引用原媒体版本，也允许未归档的临时探索草稿，但提升为正式资产必须显式动作。
3. Edge 区分 `reference`（角色→镜头）与 `execution`（图片→视频生成），各自有类型白名单；执行依赖必须无环，后端重复校验。
4. 多人先 `expectedRevision`/409 冲突+自动保存/快照；CRDT 实时同改属于后续专项，不用它阻塞 V1。

**基本节点**：Character、Environment、Prop、Text、Image、Video、Audio、Shot、GenerationTask、Group。生成节点只通过既有 GenerationJob API 提交，不另建一套队列。建议按 Scene/Unit 切 Board，避免一次渲染几千张复杂卡。

### 10.2 Skills（单项能力）

Schema：`id`, `semver`, `displayName`, `inputSchema`, `outputSchema`, `permissions`, `requiredCapabilities`, `timeout`, `deterministicChecks`, `runtime`。技能是可测试的纯业务调用单元，例如 `storyboard.breakdown`, `character.design`, `staging.plan`, `prompt.quality_check`。

第一阶段**仅内置、受信任 Skills**：不自动运行用户上传的第三方代码；第三方技能要引入进程隔离、最小权限、网络白名单、资源限制与包签名/审核。

### 10.3 Recipe（流程编排）

Recipe=版本化 DAG：每个节点引用一个 Skill/Provider 操作，保存输入输出合同、条件、重试与人工门禁。执行由 Worker 而非画布控制；可以从 CLI、API、Agent 或 UI 发起。所有可能产生费用或改写正式资产的环节都必须有人确认或满足显式授权策略。

### 10.4 Agent（规划与操作）

Agent 只能**提出操作计划与调用现有 API**，不得直接写 DB；输出受 Schema 约束，工具调用经过权限和审计；昂贵批量任务先预检并确认。Agent 失败不影响人工编辑。支持把 Skills 当积木组合，但禁止一个超级 Agent 无限制持有数据库、网络和系统文件权限。

### 10.5 3D 导演台扩展边界

预留 `PrevizProvider` 输入：`SceneRevision + CharacterRefs + CameraPlan + Props`；输出：机位参数、截图 `MediaVersion`、空间草图/metadata。第一阶段不用实现 Three.js/R3F；可先用场景顶视草图与人工站位数据。

## 11. 模块 H：前端 UI 设计规格与页面落点

### 11.1 设计 Token（深色默认，允许浅色）

```css
:root[data-theme='dark'] {
  --bg: #101217;
  --panel: #191D25;
  --panel-hover: #252B36;
  --border: #343B49;
  --primary: #7C9DFF;
  --success: #37BFA5;
  --warning: #E5AF62;
  --danger: #E7777E;
  --text: #ECEFF5;
  --text-secondary: #9BA5B5;
  --radius: 10px;
}
```

**原则**：色彩用语义 Token，不要把模型品牌色覆盖全 UI；保障对比度、焦点框、键盘交互。浅色主题需单独 token，不是全局反色。

### 11.2 工作台骨架

- 顶部 GlobalBar：56px（Workspace、Project、搜索、通知、用户）；左侧导航：216px 展开或 64px 收起。
- 中央 AppWorkspace：根据路由分别为剧本、故事板、画布、资产、任务、时间线；右侧可折叠 Inspector：320–360px；底部 JobDrawer：任务与日志，可展开，不抢占主屏。
- `Layout` 可按工作台隐藏左右面板；Canvas 支持全屏；手机优先浏览/评论/审批/查看进度，不保证复杂画布全部可编辑。
- 先引入 `AppShell` 和 design tokens，再逐步迁移现有 `main.tsx`/`style.css`。优先低风险的小屏问题，不因追求统一视觉一次重写全部 UI。

### 11.3 具体页面

| 页面 | 主要信息 | 主操作 | 不可遗漏 |
|---|---|---|---|
| 项目仪表板 | 进度/待审/失败/待办/成本 | 进入制作、分配任务 | 按角色筛选、最近工作 |
| 剧本工作台 | 文稿+版本+原文来源 | 选段分析、修订/锁定 | 不可变历史、409 |
| 故事板 | 镜头卡、时长、人物/场景、生产状态 | 编辑卡、生成提示词、创建任务 | 批量筛选、可审核 |
| 资产中心 | Character/Environment/Prop/Voice | 新增版本、定妆、引用 | 三视图、主锚、角色状态 |
| 无限画布 | 节点图、Inspector、Prompt Dock | 连线、探索、归档 | 引用版本、不重复业务数据 |
| 任务中心 | 我的任务、项目任务、批次 | 认领、提交、重试 | 权限、过期、筛选 |
| Take 审核 | 候选视频和生成历史 | 对比、标注、批准/拒绝 | 时间码评论、批准版本冻结 |
| 预演与交付 | 选片顺序/计划时长/媒体/声音与字幕来源 | 轻量预演、标准原件/CSV/JSON交接 | FFmpeg验证、固定版本，不扩展剪辑器 |
| 设置 | 成员/模型/存储/预算 | 修改配置 | 凭据掩码、连通测试 |

## 12. 代码布局建议（与现有仓库最小冲突）

```text
PulletStudio/
├─ apps/
│  ├─ api/src/
│  │  ├─ auth/                 # 已有，保留
│  │  ├─ production/           # 已有，保留后拆子模块
│  │  ├─ scripts/              # 已有
│  │  ├─ analysis/             # 已有
│  │  ├─ providers/            # 已有 TextProvider；新增 media 子模块
│  │  ├─ prompt/               # Phase B 新增
│  │  ├─ assets/               # Phase C 新增
│  │  ├─ storage/              # Phase C 新增
│  │  ├─ generation/           # Phase D 新增
│  │  ├─ reviews/              # Phase E 新增
│  │  ├─ assignments/          # Phase E 新增
│  │  ├─ timeline/             # Phase F 新增
│  │  ├─ canvas/               # Phase G 新增
│  │  └─ skills/               # Phase G 新增
│  └─ web/src/
│     ├─ components/           # 现有组件逐步移入 features，不直接删
│     ├─ app/{AppShell,router}/
│     ├─ features/{script,storyboard,assets,canvas,tasks,timeline}/
│     └─ styles/{tokens,layout,components}.css
├─ packages/
│  ├─ contracts/src/          # 已有，逐步扩展而非替换
│  └─ plugin-sdk/              # Phase H，真实需要时再新增
├─ workers/
│  └─ python-media/            # 可选；不设为前置依赖
├─ docs/
│  ├─ IMPLEMENTATION-STATUS.md # 唯一当前进度
│  ├─ architecture/
│  └─ modules/                # 各阶段短实施合同
└─ tests/
```

## 13. 开发执行顺序、工作包、依赖与退出门禁

> 这不是按天数安排。Codex 每次先审计本地代码，然后做**一个可测试的垂直工作包**；合并前更新状态和回滚方法。已存在功能先验证，不再重复开发。

| Phase | 最小工作包 | 依赖 | 验收门禁 | 不做什么 |
|---|---|---|---|---|
| A 基线 | A1 实际分支/测试核查；A2 过时文档优先级；A3 旧 Compose 隔离 | 无 | 本机 CI 等价检查、已有数据备份恢复、模块依赖图 | 迁移框架/重建 DB |
| B 文本交付 | B1 完整手工 ShotCard；B2 PromptProfile/Compiler；B3 导出 MD/JSON/CSV | A | 真实项目无需模型也可生成完整镜头文档 | 云媒体生成 |
| C 资产 | C1 安全 Local Storage；C2 原始媒体导入/预览；C3 语义资产与版本；C4 绑定 Shot | B 可部分并行 | 角色三视图/场景/道具/声音可复用，源文件哈希不变 | 直接写 NAS 绝对路径到镜头 |
| D 生成 | D1 Provider 契约/能力；D2 数据库队列/Worker；D3 ComfyUI Mock；D4 真实图/视频联调；D5 Take 归档 | C | 实际生成结果成为可审核的 MediaVersion/Take | 超时盲目二次付费 |
| E 团队 | E1 分工/任务；E2 Take 审批/评论；E3 Batch Dry Run/限流；E4 通知/进度 | D | 3 人 2 项目、20 镜头，跨租户/409/失权安全 | WebSocket 实时同改先行 |
| F 交接 | 声音素材/字幕来源；既有顺序预演；原件/CSV/JSON/说明ZIP；SRT按来源增量 | D/E | 独立解包核对镜头/Take/媒体/审核版本；可选样片，项目重导入另验 | 多轨剪辑、转场、关键帧、调色、特效、专业混音 |
| G 画布/AI | G0底座；G1 BoardRevision/真实引用/RBAC/CAS；G2现有生成/候选闭环；Skills/Recipe/Agent后置 | C/D/E | 同一固定业务版本；注释连线不改Shot；正式写入/生成走现有API | 第二业务事实源/执行DAG/未授权插件执行 |
| H 发布 | H1 Compose+安全反代；H2 备份/恢复; H3 S3/迁移；H4 SDK/示例插件/文档 | A–G 可穿插 | 干净机器可部署、打包导入、示例 Provider 能跑 | 在未测试下声称生产可用 |

### 13.1 必须遵循的开发节奏

- 每个模块开始前创建 `docs/modules/<module>-IMPLEMENTATION.md`：目标、现有复用路径、DB/API/前端变化、权限、失败处理、测试。不是另建完整总体方案。
- 严禁只生成 20 张空表就宣布模块完成；必须提供 UI/API/持久化/测试贯通的最小链路。
- 每次变更之后执行相应 `npm run typecheck`, `npm run build`, `npm test`, `npm run test:e2e`；迁移执行 SQLite 完整性、外键、回滚验证；不要使用真实用户库跑破坏性测试。
- 阶段通过后更新 `IMPLEMENTATION-STATUS.md` 的证据链：commit、测试结果、功能截图、已知边界及下一任务。
- 有项目真实数据时迁移前在线备份；上传的媒体和加密主密钥必须纳入新的灾备策略。

### 13.2 三类验收项目

1. **旁白长视频**：《盘古》作为真实数据，但不在代码/默认模板中写死题材。测试大段原文来源、完整提示词、图片/视频混合、音轨策略。
2. **人物短剧**：至少 2 人物、1 室内场景、10–20 镜头，角色三视图和音色、对白、服装一致性、制作任务与审核。
3. **30 秒广告**：从 Brief/空白开始，不强制小说剧本，支持产品道具参考与快速生成。

### 13.3 错误与恢复门禁

- 数据库/文件：备份文件可校验，业务级恢复不丢 Shot ID/历史。
- Provider：未知提交不盲目重试；归档失败不标 `completed`；下载结果 URL 受控。
- 授权：管理员和 Reviewer 角色不自动授予其他 Workspaces 的读写；所有请求做服务端校验。
- UI：409、网络断开、失败保存时保留输入；视觉和键盘焦点可用；手机可查看/审核。
- 资产：旧文件和历史引用不可变、先校验再删除、无权限用户不可通过链接直接访问。

## 14. FastAPI 评估：明确的触发条件

| 能力 | FastAPI/Python 的优势 | 目前替代 | 何时引入 |
|---|---|---|---|
| PyTorch/Diffusers/Whisper | AI/音频模型与推理生态 | 调用 ComfyUI/HTTP 模型服务 | 有必须本机推理的非 ComfyUI 功能 |
| OpenCV/视频分析 | CV 算法与生态方便 | FFmpeg/FFprobe+Node 子进程 | 需要镜头检测、自动构图质量评分等成熟 Python 包 |
| 复杂 3D/视觉预演 | Python/Blender 脚本能力 | 浏览器 Three.js / 外部工具 | 确定可复用 3D Previz 插件并需要 Blender 后台处理 |
| Agent Python 工具链 | 某些框架原生 Python | Node Skills + HTTP LLM Provider | 证明某个 Python Agent 功能明显更稳定且有团队维护能力 |

只有命中具体需求时增加 Python Worker：Node 为任务权威，Python 接受受控请求、返回 Media/Artifact，不直接增删业务表、不拥有用户会话、不复制 RBAC。绝不为使用 Python 而重写现有 NestJS。

## 15. 安全、许可证与开放生态底线

- **API 密钥**：只在服务端存加密凭据；密钥轮换/吊销机制增量开发；日志、Prompt 和客户端响应不泄露。
- **SSRF**：复用现有文本端点批准/DNS 固定原则，扩展到媒体结果下载；对可信私有 ComfyUI 采用单独显式批准的受控连接，不能通过普通 URL 参数任意访问内网。
- **上传/输出**：流式/大小配额/媒体类型验证/病毒检查可插拔/文件路径隔离/内容分发鉴权。
- **插件权限**：外部 Skill 不受信任，禁止在 API 进程内直接执行任意脚本；后续使用隔离进程或容器和权限声明。
- **许可**：不得把 Huobao（NC）或 DramaClaw（Elastic）源码直接合并进拟开源核心；任何第三方素材与模型权重需单独许可登记。对 MIT/Apache 项目复制代码也需要保留许可和归属。
- **可移植**：项目导出不包含 API Key、会话 Cookie、用户密码/密钥；工作区成员权限映射需导入时重新确认。

## 16. Codex 执行总指令（建议仅此一段）

> 先阅读本文件与 `AGENTS.md`、`docs/IMPLEMENTATION-STATUS.md`、`docs/MASTER-PLAN.md`、`docs/ADR-001-stack.md`–`ADR-004-production-units.md`，并查看 `README.md`。
> 以本地工作树为实际事实源；仓库基准 SHA 仅是规划依据。
> **不要迁移 FastAPI；不要重建数据库；不要删除既有剧本、镜头、审核历史；不要整体 Fork 开源软件。**
> 按本文件 Phase A→H 的依赖顺序实施，每次只做具备验收条件的最小垂直工作包。已实现部分直接复用并补测。
> 本轮先完成 Phase A 复核及 Phase B1/B2 可验证的最小链路；提交实际测试报告、变更清单、迁移/回滚说明、Git commit、下一工作包。
> 涉及真实模型凭据、ComfyUI 内网地址/实际工作流 JSON、个人声纹、生产服务器公开访问、昂贵批量任务、破坏性迁移时，请先提交需要用户操作/批准的最小信息；除此之外自主设计并开发。
> 不要只写计划；必须交付可运行代码和验收证据。

## 17. 产品与工程验收的最后标准

最终 V1 不是“页面数量完成”，而是具备可重复的团队生产闭环：创建工作区和项目→输入故事/剧本→批准结构化分镜→配置/复用角色、场景、道具、声音→生产或导入素材→挑选 Take→团队审核、返工和批量调度→预演与导出。所有产物有版本来源、权限、可恢复的工作状态与可迁移的项目资产。**团队级内核先完成，开放插件 SDK 在安全隔离验证后发布。**
