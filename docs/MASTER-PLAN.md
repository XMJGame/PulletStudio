# Pullet Studio — V1.0 通用 AI 影视创作平台完整实施方案

> 2026-11-05 决策说明：本文保留长期产品需求；主技术栈已由 ADR-001 确定为 NestJS/React/Drizzle/SQLite，下文 FastAPI/SQLAlchemy/Alembic 及重建 M0 的示例不再执行。团队级模块规格见 `architecture/TEAM-V1-TECHNICAL-BLUEPRINT.md`，实际状态与顺序唯一来源为 `IMPLEMENTATION-STATUS.md`。

> 2026-11-05 产品边界更新：[ADR-009](ADR-009-production-and-postproduction-handoff.md)。Pullet负责AI影视生产与素材交付，专业软件承担正式后期。生产工作台和创作画布为核心入口；镜头顺序/计划时长、媒体预览、轻量故事板连续播放、可选FFmpeg低清预演保留，不扩展为多轨剪辑器。标准原件/CSV/JSON先交付，声音与SRT基于确切来源逐步接入，OTIO/FCPXML后置并逐软件验证。不新增转场、关键帧、调色、特效合成或专业混音；旧文中相关长期建议不再驱动实施。

> 版本：1.0 / 2026-11-04  
> 状态：**实施基线（待 Codex 勘察仓库后按里程碑实现）**。本文不是“现已实现”的功能清单。  
> 产品目标：个人可用、团队协作、可私有化、以后可对外分发；从短视频、广告、AI 漫剧、连续剧、旁白长视频到长篇电影共用一套业务核心。  
> 第一个真实验收项目：《盘古：天地诞生之前》。该作品只是验收样本，**任何业务代码不得硬编码盘古、神话、旁白、水墨、16:9 或特定 Provider**。

> 文档整理说明：当前完成情况、依赖与下一工作包只见[IMPLEMENTATION-STATUS](IMPLEMENTATION-STATUS.md)，阅读入口见[docs/README](README.md)。本文M0–M6用于需求追溯，旧FastAPI/Alembic及框架/表名示例不作为重构授权；技术实现依据有效ADR、实际NestJS/Drizzle代码和阶段合同。历史验收已分离至history，不在本基线重复维护。

---

## 0. 本文使用方法与决策冻结

本方案直接交给 Codex，要求以里程碑为单位实现。**先检查现有仓库，再施工**，每个里程碑必须：迁移、API、页面、测试、文档、部署/回滚说明齐全。

**冻结的技术选择：**

- Web：React + TypeScript + Vite，Tailwind CSS、shadcn/ui，TanStack Query、Zustand；React Flow `@xyflow/react` 在 V1.5 引入；Tiptap 先单人版本编辑，真正协同富文本在 V1.5。
- 后端：**Python FastAPI + Pydantic v2 + SQLAlchemy 2.x + Alembic**；测试 pytest、httpx、Playwright；ruff、mypy（逐步）、ESLint/TypeScript。
- V1 数据库：**SQLite**（单后端实例、WAL、foreign_keys=ON、busy_timeout、短事务）；长期 PostgreSQL（专门迁移程序，非配置开关一键切换）。DB 文件放本机持久化卷，不允许放 SMB/NFS。
- V1 后台任务：**基于数据库的持久化任务队列 + 单独 Worker 进程**，使用原子领取/租约/幂等/心跳/超时/恢复；不要在 FastAPI 的内存 `BackgroundTasks` 中执行长视频任务。SQLite 下先单实例队列服务，可分多队列逻辑通道；在负载增长时迁移到 PostgreSQL + Redis/Celery 或其他成熟队列，不把任务协议绑定队列实现。
- 文件存储：Storage Adapter，**默认 Local**，V1 支持管理员配置的挂载目录（NAS），下一迭代支持 S3 兼容（MinIO/S3）；OSS/COS、CDN 分发按后续模块实现。CDN 是 Delivery，非默认主存储。
- 模型：**Text / Image / Video / Speech / Audio 独立能力接口**；ComfyUI 是第一个真实图像/视频 Provider；文本 Provider 优先标准 OpenAI-compatible API（可连接具有兼容接口的本地或云端 LLM）。不同模态、任务模式能力独立，不声称所有厂商协议一致。
- 本地推理：ComfyUI-Distributed 由用户独立部署，Pullet Studio 只调指定 Master Endpoint；普通 `POST /prompt` 和插件 `POST /distributed/queue` 作为不同的提交策略，不能假设任意普通工作流自动分配 GPU。默认 LAN only，禁止公网裸露 ComfyUI。
- 部署：Docker Compose 为主，Windows Docker Desktop + WSL2 / Linux / 支持容器的 NAS；Web 可局域网多用户访问。无 GPU 的用户也能运行项目管理与外部云生成。
- SaaS：预留租户隔离、配额和权限模型，不在 V1 实现支付、公共云租户服务或弹性 GPU 调度。

**已有旧骨架处理：**此前 ZIP 是 `pullet-studio-v1/`，只有 NestJS、React 和合约骨架。Codex 首先审计是否已有真实业务实现：若仍仅为原骨架，保留可用前端，建立 `apps/api` 的 FastAPI 实现，将旧 NestJS 样板移至 `legacy/nestjs-starter/` 或提交历史中，不同时启动两套主后端；若已有实际 NestJS 功能，必须先列出迁移成本、测试覆盖、迁移风险，经用户认可才切换，**不得擅自删用户成果**。从这一基线起只保留一种主后端。

## 1. 目标、非目标、产品边界

### 1.1 产品目标

1. **多种创作入口**：空白项目、创意概述、小说、定稿剧本、旁白文稿、广告 Brief、外部导入分镜；用户可不配置任何模型先管理项目。
2. **通用内容结构**：短视频、竖屏连续剧、AI 漫剧、长篇旁白、80 分钟电影、广告、MV、纪录片。不同类型由模板及 Profile 控制，不是不同数据表。
3. **剧本驱动**：保存原文与版本；AI 按阶段结构化分析、提出分镜草案、生成可修改的制作卡和完整提示词。AI 不能未经确认覆盖锁定原文。
4. **生产管理**：人物、场景、道具、声音角色、参考资产、分集/幕/场次、镜头、Take、审核、素材、版本、评论、任务。
5. **开放模型**：Provider / Endpoint / Model Profile / Workflow Profile 解耦；支持手动使用第三方工具后导入文件。
6. **开放存储**：本地优先，支持管理员配置 NAS 挂载，后续云存储；存储与模型、项目互不绑定。
7. **多人协作**：Workspace、项目成员、权限、分工、通知、乐观锁、操作日志；V1 不承诺 Google Docs/Figma 式同一光标实时协同。
8. **资产可追溯**：每次生成有来源、工作流版本、Prompt 版本、模型与参数；生成结果不覆盖原件。
9. **可发行/复用**：有授权的剪辑素材包、预演和项目导出；可作为以后对外发售的软件基础。

### 1.2 V1 明确非目标

- 不实现新的 GPU 推理内核、视频生成模型、GPU 集群调度器、ComfyUI Worker 安装器。
- 不保证“一键生成合格 80 分钟电影”，也不保证人脸、服装、动作一致性。
- 不开发内置专业 NLE（非线性视频编辑器）、多轨剪辑、转场编辑、关键帧、调色、特效合成或混音台；V1 提供轻量故事板预演和标准化交付，不以“后续”名义继续开发剪辑器。
- 不强制接入 ComfyUI、ArcReel、LibTV、即梦、官方账号或付费 API。
- 不抓取第三方网页的非公开接口，也不绕过服务商鉴权和付费。
- 不在 V1 使用 GPU 自动模型预缓存/清理业务；属于独立外部推理基础设施可扩展能力。

### 1.3 典型用户与部署

- **Personal**：单 Windows/Linux 主机、Local Storage、1 用户、可用云 API。
- **Team Self-hosted**：局域网 Windows/NAS/Linux、多人浏览器访问，Local/NAS、外部 ComfyUI/云 API。
- **Future Cloud**：Linux + PostgreSQL + 对象存储/CDN，真正公网租户能力以后单独审计。

## 2. 影视业务模型（必须优先于 UI 设计）

### 2.1 四个独立轴

| 维度 | 可选值示例 | 决定内容 |
|---|---|---|
| Work Format | short / longform / series / film / ad / mv / documentary / custom | 初始层级、默认页面、导出格式 |
| Narrative Mode | narration / dialogue / hybrid / music-driven / none | 剧本解析、配音方案、分镜节奏 |
| Visual Profile | ink / realistic / anime / 3D / custom | 视觉风格与 Prompt 模板，不是数据库结构 |
| Production Technique | static / animated-still / text-to-video / image-to-video / video-edit / external | 一个 Shot 的实际执行计划 |

上述字段允许独立组合，用户可更改但改变后应触发**影响分析**而非覆盖已有素材。

### 2.2 层级设计

- Workspace → Project → **ProductionUnit**（可嵌套：episode / act / chapter / sequence / scene / section）→ Shot → Take。
- Movie 可为 `Project → Act → Scene → Shot`；Series 为 `Project → Episode → Scene → Shot`；短广告为 `Project → Shot`。UI 可用不同视图呈现，同一业务模型。
- Shot 关联 `ScriptSpan`、`NarrationSegment`、`Character`、`Location`、`Prop`、`ReferenceAsset`、`ProductionPlan`、`PromptArtifact`。
- Take 不等同于 GenerationJob：一次 Job 可能返回多张图、多段视频；通过 `JobOutput` 关联一个或多个 Take / Asset。
- 不推荐直接按人可读编号做主键；数据库主键 ULID/UUID，`EP001/SH008` 仅显示、排序、导出用。

### 2.3 影视项目结构性规则

- **原始来源不可变**：ScriptDocument 保留原文件、字符编码、哈希、导入时间；ScriptRevision 保留不同修订内容，支持 approved/locked；原文不可被生成结果静默替换。
- **源文本定位**：ScriptSpan 包含 `revision_id, start_offset, end_offset, text_hash`；算法拆分后能回指原文。跨版本重定位单独处理，不保证 offset 自动稳定。
- **分镜草稿不是正式数据**：AI 产出 `AnalysisRun` + `Proposal`，只有用户审核后才转为正式 Scene/Shot/Asset。
- **镜头意图与执行解耦**：镜头描述不含 Provider 特有字段；Prompt Compiler 根据 Profile 编译。模型参数配置独立存储。
- **预演与镜头解耦**：保留已实现Timeline/Clip固定快照，供顺序与时长检查，不发展多轨编辑器；镜头计划时长、原件实测时长、预演实际时长分开。交付包保留原件，不代替后期剪辑工程。
- **声音素材分层**：VoiceOver / Dialogue / BGM / SFX / Ambience / GeneratedSourceAudio表示素材用途，按来源/版本/权限管理，不等于内置混音轨道；预演keep/mute不修改源视频。字幕交付须有明确文字与时间码来源，不从对白伪造同步。
- **参考资产版本固定**：已批准镜头引用具体 `AssetVersionId`，不能被新版封面图替换而悄悄漂移。

## 3. 模块化单体架构

```text
Browser (React + TypeScript)
   │ HTTPS / REST + SSE/WebSocket
   ▼
FastAPI (Auth / Workspace / Project / Script / Shot / Asset /
         Review / Provider Registry / Job / Timeline / Export)
   │                         │
   ├─ SQLAlchemy → SQLite    ├─ Storage Facade → Local / Mounted NAS / S3
   │                         └─ Delivery → protected stream / signed URL / CDN
   ├─ Persistent Job Table → Worker Process
   │                              ├─ Text LLM Provider
   │                              ├─ ComfyUI Provider (Standard / Distributed)
   │                              ├─ Cloud Image/Video/Speech Providers
   │                              ├─ Asset Ingestion + FFprobe/FFmpeg
   │                              └─ Prompt Compiler / AI Stage Worker
   └─ Event/Progress Stream → Browser
```

**依赖方向**：domain/types 不依赖 FastAPI/SQLAlchemy/ComfyUI/厂商 SDK；应用服务依赖抽象接口；infra 具体实现接口；HTTP 层只做验证、权限和映射，不包含长任务。

建议源码：

```text
pullet-studio/
  apps/web/                  # React/Vite
  apps/api/                  # FastAPI app、routes、auth、middleware
  packages/domain/           # Python 领域实体、值对象、业务规则
  packages/application/      # use case、服务端口
  packages/infrastructure/   # sql、storage、provider、queue
  packages/ai_pipeline/      # script analyzer、storyboard、prompt compiler
  workers/                   # generation、media、import/export
  migrations/                # Alembic
  tests/unit/ tests/integration/ tests/e2e/
  infra/docker/ infra/compose/
  examples/                  # 模拟剧本、工作流映射、数据样本
  docs/                      # PRD、ADR、API、部署、运维、验收
```

不要为每个功能开启独立微服务；`packages` 可以先为 Python 源码包，不必有独立发布/版本管理。

## 4. 数据库设计（V1 第一批表）

> 所有业务表均具 UUID/ULID 主键、created_at、updated_at，适用表带 `version` 乐观锁字段。统一 UTC 时间、ISO 8601 API。数据库外键、unique 和必需索引必须在迁移中实现。

### 4.1 身份、租户与组织

- `users`: id, email(unique canonical), password_hash, display_name, active, created_at, last_login_at。首版 Email + Argon2id 密码；后续可接 OIDC。
- `sessions`: token_hash, user_id, device, created_at, expires_at, revoked_at。浏览器使用 Secure/HttpOnly/SameSite Cookie；CSRF 防护（跨站写请求需要 token 或同站策略+验证）。不把长效凭据放 localStorage。
- `workspaces`: id, slug(unique), name, owner_user_id, settings_json, created_at。
- `workspace_members`: workspace_id, user_id, role, status, joined_at；唯一(workspace_id,user_id)。
- `invitations`: workspace_id, email, role, token_hash, expires_at, used_at。仅管理员邀请，无开放注册默认为安全值。
- `projects`: workspace_id, name, slug, format, narrative_mode, description, default_storage_id, status, owner_id, version。
- `project_members`（可选 V1.1）：project_id,user_id,role，用于同工作区内项目级隔离；V1 工作区角色 + 项目成员需明确策略，不得混用绕过权限。
- `audit_events`: actor_user_id, workspace_id, action, resource_type, resource_id, context_json, created_at；敏感操作记录、不记录 API Key 明文。

**RBAC 最小矩阵：** SystemAdmin 管实例配置；WorkspaceOwner/Admin 管成员/Provider/Storage；Producer 管项目与审批；Editor 管剧本/镜头；Artist 提交素材和 Take；Reviewer 审核；Viewer 只读。拒绝优先；每次服务端都从 membership + project scope 推导权限；禁止纯前端鉴权。

### 4.2 剧本与制作

- `script_documents`: project_id, source_asset_id, kind (novel/script/narration/brief), original_hash, title。
- `script_revisions`: document_id, revision_no, full_text/text_storage_id, status(draft/approved/locked), created_by, approved_by, parent_revision_id, checksum。
- `script_spans`: revision_id, start_offset, end_offset, snippet_hash, source_label。
- `production_units`: project_id, parent_id nullable, unit_type, title, sort_key, target_duration_ms, outline, status, version；防止父子循环，稳定排序。
- `shots`: project_id, parent_unit_id nullable, shot_no, title, intent, composition, framing, camera_movement, action, duration_target_ms, workflow_status, version。
- `shot_script_spans`: shot_id, span_id, usage_type。
- `narration_segments`: project_id, script_span_id, text, speaker_id nullable, target_duration_ms, actual_duration_ms nullable, timing_status。
- `production_plans`: shot_id, technique, reference_asset_version_ids, prompt_profile_id, target_media_spec, audio_policy, notes, revision_no。
- `characters`, `locations`, `props`: project_id, canonical_name, description, traits_json, status, version。正式表可统一 AssetEntity(type=...) 或分表，但需统一稳定引用。
- `entity_asset_links`: entity_id, asset_version_id, purpose, is_primary, approved_by, approved_at。
- `style_profiles`, `director_profiles`, `prompt_profiles`: scope(system/workspace/project), name, version, schema_json, template, constraints_json, created_by；模板内容版本化。
- `prompt_artifacts`: shot_id, production_plan_id, provider_profile_id, compiled_positive, compiled_negative, resolved_inputs_json, compiler_version, status, source_revision_ids_json。

### 4.3 生成、媒体、审核和任务

- `provider_connections`: workspace_id nullable for system scope, provider_type, name, endpoint_ref, encrypted_secret_ref, enabled, config_json_sanitized。
- `model_profiles`: connection_id, capability, name, provider_model_key, parameter_json_schema, limits_json, pricing_hint_json nullable, enabled。
- `workflow_profiles`: model_profile_id, workflow_asset_id, workflow_hash, binding_schema_json, output_mapping_json, submission_mode, version, status。
- `generation_jobs`: workspace_id, project_id, shot_id nullable, provider_connection_id, model_profile_id, workflow_profile_id nullable, idempotency_key, request_json, state, attempts, max_attempts, lease_until, lease_owner, next_run_at, provider_task_id nullable, correlation_id, error_code, error_message_safe, created_by, created_at, updated_at。
- `job_outputs`: job_id, provider_file_ref_json, asset_id nullable, output_index, media_type, status；唯一(job_id,output_index)。
- `storage_connections`: scope, type(local/mounted/s3), name, base_ref, secret_ref, capabilities_json, enabled；本地路径只允许系统管理员设置。
- `media_assets`: workspace_id, owner_project_id nullable, media_type, mime, size_bytes, checksum_sha256, created_by, origin_kind, created_at；不保存硬编码绝对路径。
- `asset_versions`: asset_id, version_no, storage_connection_id, object_key, checksum, metadata_json, provenance_json, status, created_at；原件不可覆盖。
- `takes`: shot_id, asset_version_id, generation_job_id nullable, take_no, status, selected, created_by；多输出可生成多个 Take。
- `reviews`: project_id, target_type, target_id, review_status, reviewer_id, comment, created_at。
- `comments`: project_id, target_type, target_id, author_id, body, created_at。
- `timeline_versions`: project_id, unit_id nullable, revision, status, fps_num, fps_den, resolution, created_by。
- `timeline_clips`: timeline_version_id, track_type, take_id/asset_version_id, start_ms, trim_in_ms, trim_out_ms, gain, source_audio_policy, order_index。
- `export_jobs`: project_id, timeline_version_id, format, status, output_asset_id nullable, created_at。

**结构调整限制**：先写可执行迁移和核心表的 ERD，再编码；不是所有表必须在 M1 建好。迁移不能重置生产数据库，删除字段先提供迁移程序与备份。

### 4.4 并发与隔离

- 任一项目相关表能通过 project_id 追溯 workspace_id；重要表直接冗余 workspace_id 便于索引与校验，但需一致性约束。
- API 查资源时用 SQL 条件同时限定 `resource_id AND workspace_id`，不能先凭 ID 查询再仅依赖 UI 的工作区参数。
- REST PATCH 接 `expectedVersion` 或 `If-Match`，不匹配返回 409，保留用户草稿并展示差异；编辑保存不采用“最后写入者无条件覆盖”。
- 列表分页（cursor 优先）、复合索引 `workspace_id, project_id, updated_at`。
- SQLite 不应直接承受每帧进度数据写入；进度事件可内存广播，持久化节流（例：每几秒或状态变更）。

## 5. API 设计与事件

全 API 以 `/api/v1` 开头；错误统一为 `{code,message,details?,requestId}`；统一分页；所有外部请求认证、授权、校验、速率限制；产生更改的任务接口接 `Idempotency-Key`。

**身份/工作区**：
`POST /setup/admin`（仅未初始化、一次性受控）、`POST /auth/login`、`POST /auth/logout`、`GET /auth/me`、`GET/POST /workspaces`、`POST /workspaces/{id}/invitations`、`GET /workspaces/{id}/members`。

**项目和结构**：
`GET/POST /projects`、`GET/PATCH /projects/{id}`、`POST /projects/{id}/scripts/import`、`GET /scripts/{id}/revisions`、`POST /scripts/{id}/revisions/{rid}/approve`、`GET/POST /projects/{id}/units`、`GET/POST /projects/{id}/shots`、`PATCH /shots/{id}`、`POST /shots/{id}/reorder`。

**AI 创作**：
`POST /scripts/{revisionId}/analyze`、`GET /analysis-runs/{runId}`、`GET /analysis-runs/{runId}/proposals`、`POST /proposals/{id}/approve`、`POST /shots/{id}/compile-prompt`、`GET /shots/{id}/prompt-artifacts`。

**素材/模型**：
`POST /assets/uploads/initiate`、`PUT /assets/uploads/{id}/chunk`（V1 可整文件上传，需限制大小）、`POST /assets/uploads/{id}/complete`、`GET /assets/{id}`、`GET /assets/{id}/download`（授权流式/重定向）、`GET/POST /connections/generation`、`GET/POST /connections/storage`、`GET/POST /models`、`GET/POST /workflows`、`POST /workflows/{id}/validate`。

**任务/审核/输出**：
`POST /generation-jobs`、`GET /generation-jobs/{id}`、`POST /generation-jobs/{id}/cancel`（能力性取消）、`POST /generation-jobs/{id}/retry`（先检查远端状态）、`GET /projects/{id}/takes`、`POST /takes/{id}/submit-review`、`POST /reviews/{id}/approve`、`POST /reviews/{id}/reject`、`POST /exports`、`GET /exports/{id}`。

**实时**：首版建议 `GET /api/v1/events` SSE（登录态、授权订阅、Last-Event-ID 恢复可渐进实现），提供任务状态变更、审核通知、文件归档状态；真正剧本编辑使用 Yjs/Hocuspocus 为 V1.5。状态事件不应成为唯一可靠状态源；刷新网页可通过数据库恢复。

## 6. Provider 架构（插件契约）

### 6.1 概念

- `ProviderType`：ComfyUI、OpenAI-Compatible Text、Kling、Volcengine 等。
- `ProviderConnection`：用户或管理员配置的实际端点、凭据，按 Workspace 授权。
- `ModelProfile`：一个可用模型/能力，声明能力和动态参数 JSON Schema、输入输出形态、限制。
- `WorkflowProfile`：仅某些 Provider 需要，包含 ComfyUI API prompt、参数映射、节点输出映射、版本与哈希。
- `GenerationRequest`：业务统一输入（capability、prompt、asset references、requirements、provider-specific options），存储请求快照。
- `ProviderJobHandle`：上游任务 ID、状态、提交时间；`ResultDescriptor`：inline bytes / upload stream / provider file id / authenticated result URL / outputs array。

### 6.2 模态与能力不混淆

建议 `Capability`：`text.analyze`、`text.generate`、`image.text_to_image`、`image.edit`、`video.text_to_video`、`video.image_to_video`、`video.first_last_frame`、`audio.tts`、`audio.music`、`audio.sfx`、`video.upscale` 等。

按能力声明每个模型是否支持：参考图数量、首/尾帧、时长枚举、比例、分辨率、Seed、负面词、音轨、取消、回调、异步轮询、价目。**不要求所有 Provider 实现所有能力**，前端按 schema 渲染并校验。

### 6.3 抽象接口（伪代码）

```python
class GenerationProvider(Protocol):
    async def capabilities(self) -> ProviderCapabilities: ...
    async def submit(self, request: GenerationRequest) -> ProviderJobHandle: ...
    async def poll(self, handle: ProviderJobHandle) -> ProviderJobStatus: ...
    async def get_results(self, handle: ProviderJobHandle) -> list[ResultDescriptor]: ...
    async def cancel(self, handle: ProviderJobHandle) -> CancelResult: ...

class TextProvider(Protocol):
    async def generate_structured(self, messages: list[Message], schema: dict, options: dict) -> StructuredResult: ...
```

- `cancel` 需要 `supported: bool`；不支持时只能标记本地不再等待，不得声称远端已取消。
- 同一个生成任务重试可能重复扣费，**先对上游按 provider_task_id 查询**；连接超时不能直接判断提交失败。
- 生成结果 URL 可能短期失效，需限时导入；服务端下载远端文件必须有 SSRF 防护（允许 HTTPS、拒绝保留/回环/链路本地地址、DNS 复核、重定向重检和体积限制）。对于用户批准的内网 ComfyUI 端点，使用独立受控的 trusted endpoint 策略，禁止任意输入 URL。

### 6.4 ComfyUI Provider 的两种提交模式

**普通工作流**：使用服务器 `POST /prompt`；返回 `prompt_id`，使用 `/history/{prompt_id}` 与 `/ws` 获取状态，`/view` 接收输出，参考图可能需 `/upload/image`。该模式不应承诺分布式负载均衡。

**Distributed 模式**：使用插件 `POST /distributed/queue`，提供 API 格式 prompt、client_id、插件配置中的 enabled_worker_ids、可选 trace_execution_id。必须是支持分布式节点的工作流；如果无分布式节点可能退回 Master 普通队列。Worker 管理完全交给插件；Pullet Studio 只处理返回的 prompt_id、任务状态、素材。插件 API 属实验性，必须做版本兼容测试。详情参考：`https://github.com/robertvoy/ComfyUI-Distributed/blob/main/docs/comfyui-distributed-api.md`。

**Workflow Binding**：上传 *API-format* JSON（非仅普通 UI workflow）。可手动绑定 `positive_prompt`, `negative_prompt`, `source_image`, `last_image`, `seed`, `width`, `height`, `frames`, `fps` 等到节点 JSON path；绑定时通过 ComfyUI `/object_info` 验证可用类型；输出映射可支持多图/多视频/音频，不能仅假设 SaveImage 节点。绑定快照不可变且随 Job 存档。暂不做“自动猜节点 ID 一定正确”。

**执行过程**：上传可访问的参考文件 → 克隆已批准 workflow JSON → 映射参数并验证 → Submit → 持久化 prompt_id → Poll/WebSocket → History → 枚举全部输出 → Ingest → 生成 Take。Master 或 Worker 文件路径由 Provider 解释，Studio 不能直接读 Worker 磁盘。

**安全**：自部署 ComfyUI 默认无完善多租户鉴权，Studio 通过服务端代理调用；ComfyUI 内网防火墙/反向代理/VPN，不能在公网直连暴露。即使设置 `--enable-cors-header` 也不等于认证。

## 7. Text Agent 与剧本转分镜流水线

### 7.1 任务分段

1. **Import**：文件上传/文本粘贴 → 保留原始字节 + 文本 → OCR 仅在确实是图像扫描且其他解析方式不可用时考虑（V1 可不支持扫描 PDF）；TXT/MD/Docx/PDF 文本解析独立 adapter。
2. **Normalize**：按标题、场次、段落、对白、旁白分段，保留 source span；审查原文是否丢字、乱序；形成 Script Revision。
3. **Story Bible**：人物别名与关系、地点、时间顺序、世界观、艺术风格、禁忌/考据边界。AI 结果为候选，不擅自变更原稿。
4. **Structure Proposal**：按类型拆分 episode/act/scene/section 和 beats；有原文定位、置信/不确定性标记。
5. **Shot Proposal**：按用户设定的导演 Profile、时长、叙事节奏，把段落转镜头候选；保留对齐关系。
6. **Prompt Compilation**：依 Shot Intent + StyleProfile + ModelProfile + Negative Constraints 生成完整、单镜可复制的提示词；保留分段字段和完整编译版本。
7. **Human Gate**：每一阶段由用户 Approve / Reject / Edit；锁定的剧本不允许改写。
8. **Optional Generation**：选定的镜头或批次进入生成任务；不强制自动全部执行。

### 7.2 长篇处理

禁止“80 分钟电影全部剧本一次提交 LLM，直接输出 1000 个镜头”。先做分层处理：全剧 bible → 幕/集 → 场次 → 镜头；每层输入只带**经过批准的必要上下文摘要**与相关原文范围，输出结构化 JSON 并 Pydantic 校验；保持人物 ID、场次 ID、故事时间线；模型上下文不足要分批处理并保留进度。关键阶段用二次审查模型/人工审查可选。

### 7.3 旁白长视频 vs 对白剧情 vs 广告

- Narration：先确定正式 VO/试听音频与时长，再分镜、做 Animatic。不能按每镜固定 5 秒硬凑时长。
- Dialogue：先分场/人物台词/动作节拍，保证相邻镜头服装、站位、目线、道具、声画连接。
- Music-driven：先按节拍/歌词/片段切分，再规划镜头。
- Ad：Brief/产品参考图优先，可以无完整剧本。

### 7.4 输出的镜头卡必备字段

镜头编号、标题、所属段落/场次、source span、对应旁白/对白、创作意图、出场资产、画面描述、景别、视角、构图、运镜、动作、情绪/光线、推荐时长、推荐制作方式、图片提示词、视频提示词、负面约束、音频需求、生成提示词模板版本、审核状态、风险点。一个镜头可仅生成文字，不需要图片/视频模型在线。

### 7.5 作品验收样本

- **《盘古》**：8–10 分钟、旁白型、神话视觉模板，验证原文锁定、长旁白分镜、完整提示词、图片/图生视频混合、模型生成声音策略。**必须使用用户确认的全文剧本，不能用剧情概要替代正式验收。**
- **都市悬疑**：3 分钟，2–3 角色、有对白、连续场景和时间连续性，验证演绎型工作流。
- **产品广告**：30 秒，无完整剧本、有参考图、画幅/字幕/节奏，验证 Brief 入口。
- **电影压力样例**：模拟 80 分钟、数百个镜头（无需真实渲染），测试结构化解析、分页、导出和批次性能。

## 8. Prompt Compiler

- `ShotIntent` 和 `DirectorProfile` 是 Provider-neutral，不应存在 `comfy_node_6` 等实现细节。
- `PromptProfile` 描述目标模型的语言偏好、镜头描述模板、负面提示词支持、参考图/画幅/时长等能力；应有版本。
- 输出必须包含 `compiledPrompt`（直接复制）、`negativePrompt?`、`structuredSegments`、`metadata`、`validationWarnings`；不得只保留散落的提示词片段。
- 对即梦等非 API 网页生成，允许 **复制提示词 + 手工上传结果**，不要构造非公开 API。
- prompt 变更产生新 `PromptArtifact`，旧的 Take 始终追溯到原先编译版本和输入资产版本。

## 9. Asset Storage / Ingestion / Delivery

### 9.1 Storage 抽象

```python
class StorageBackend(Protocol):
    async def put_stream(self, key: str, source: AsyncIterator[bytes], metadata: dict) -> StoredObject: ...
    async def open_stream(self, key: str, byte_range: tuple[int, int] | None = None) -> AsyncIterator[bytes]: ...
    async def stat(self, key: str) -> ObjectStat | None: ...
    async def delete(self, key: str) -> None: ...
```

- Local 和 Mounted NAS 共用“受限目录”实现（只允许管理员配置 root；路径规范化、防止 `..`、symlink 跳出根目录），不要为 SMB 另造复杂客户端。
- 对象存储 S3 Adapter 另行实现；私有素材必须带签名 URL/授权代理，CDN 不一定可安全共享敏感原稿。
- Asset 用 `assetId + assetVersionId`，Storage 用 `storageConnectionId + objectKey`，业务代码不见绝对路径或 NAS IP。
- 文件前缀建议 `workspaces/{workspaceId}/projects/{projectId}/assets/{assetId}/versions/{versionId}/{safeFilename}`；可选“人类可读导出目录”由 Export Service 映射，不把展示名称当主存储键。

### 9.2 导入任务

`ResultDescriptor` → 安全获取/下载 → 临时文件 `.part` → 大小限制/媒体探测/Hash → 归档主存储 → read-back/元数据校验 → DB 事务注册 AssetVersion/JobOutput/Take → 完成状态；失败保留可恢复的 staging，后台扫描 orphan/partial 并补偿。远端临时 URL 应在有效期内及时抓取。

- ComfyUI 自身的 output 与 Studio 主素材库可以各保留一份；默认**不删除外部 Provider 源文件**。
- 若 Studio 主存储与生成输出位于同一文件系统，可在后续优化 reflink/hardlink/迁移，V1 默认安全复制。
- 由 ComfyUI 网页手工生成的内容可通过用户主动导入；不能把整个 Master output 目录无差别复制进项目。
- Storage 迁移按 `copy → checksum → metadata commit → optional delayed delete`；数据库状态必须可以恢复部分失败。

### 9.3 文件上传及分发

- 服务端上传设置体积限制、可用磁盘检查、临时文件隔离、格式白名单、反病毒/恶意媒体风险检查可后续加固。
- 读取/下载必须校验 Workspace/Project 权限；不要把 NAS 本地路径回给浏览器。
- 视频预览优先生成代理转码和 poster，原片不可变；支持 HTTP Range。
- CDN 仅作为 Delivery Adapter，公网分享需显式授权、有效期和可撤销机制。

## 10. 任务状态机、恢复与错误处理

### 10.1 生命周期

`Draft → Queued → Preparing → Submitted → Running → Collecting → Ingesting → Completed`。

异常分支：`RetryWaiting`, `NeedsReconciliation`, `Failed`, `Cancelled`, `CompletedWithWarnings`。

**完成定义**：远端生成成功 ≠ Studio Completed。只有所有要求的输出完成主存储归档、哈希/元数据记录、Take 关联后才 Completed。

### 10.2 任务一致性

- 创建任务先 DB 事务写记录，返回 Studio Job ID；保存上游 provider_task_id、请求 hash、提交 trace ID。
- 本地 worker 领取使用事务 + lease，`lease_owner/lease_until`，重复领取必须幂等。对 SQLite 并发领取做压力测试。
- 超时或网络断开：如果上游提交状态不确定，先 `NeedsReconciliation` 查询上游，**不自动重投**（避免重复扣费/生成）。
- Retry Policy 按错误分类：可重试连接重置、429（尊重 Retry-After）、5xx；不可重试权限/参数/模型缺失；进度状态可恢复。
- Provider 没有真正 cancel 则 UI 显示“停止跟踪/后续不导入”而非“远端已取消”。
- 任务队列按 `text/image/video/audio/media` 逻辑分通道和并发限制，长视频任务不能阻塞所有短文本任务。

### 10.3 可观测性

每次请求 request_id，每个 Job correlation_id、上游 prompt_id、profile_version、workflow_hash、user、workspace、耗时、retry count、文件大小、估算费用；结构化日志脱敏 API keys/提示词敏感信息；后台有失败任务检索、重试、人工调和入口。

## 11. 多人协作与审核

- Workspace 先做成员加入、RBAC、按项目任务分配；项目列表、剧集、镜头、审核信息共享。
- 编辑采用 optimistic locking；“别人正在编辑”可用软提示但不能取代冲突校验。
- 审核：Draft / Submitted / InReview / Approved / Rejected；已批准 Take/剧本版本不能被同名重生成覆盖。
- 评论针对具体版本，保留作者、时间、原对象关联。
- SSE 推送任务与审核状态；文本实时同步/共编辑(Yjs)后续开发。系统通知持久化，用户掉线后仍可查看。
- 审计：登录、成员角色变更、存储/Provider 凭据修改、审批、导出、删除等关键事件。

## 12. UI 页面与主要交互

1. **初次启动 Setup**：管理员初始化、选择本地存储目录、创建第一个 Workspace；无需配置模型即可完成。
2. **工作区与项目**：项目卡片、成员、任务动态、存储策略。
3. **新建项目向导**：格式、叙事方式、比例、时长、语言、导演风格、可选模板；允许纯空白、小说/剧本/旁白/广告 Brief 四入口。
4. **剧本编辑器**：版本、导入、原文锁定、段落定位、批注、AI 提议差异审批。
5. **故事结构**：幕/分集/场次/章节树与事件卡；拖拽排序保持 ID 不变。
6. **资产中心**：人物、场景、道具、声音角色、参考图、批准版本；缩略图、版本历史。
7. **分镜列表/故事板**：每镜完整制作卡；表格、卡片双视图；批量审核、时长估算、来源旁白映射。
8. **生成面板**：模型 Provider 与 Profile 动态选择、参考资产、参数、预估费用（若供应商可提供）、任务队列、结果预览。
9. **Take 审核**：多个候选对比、选择批准、评论与退回；视频可静音预览。
10. **轻量故事板预演与交付**：按已选镜头顺序检查叙事节奏、缺片、计划时长及原件完整性，可选FFmpeg低清预演；保留已有简单片段能力，不再扩展专业轨道UI。重点交付原件、声音/字幕来源、CSV镜头清单、制作说明及manifest，专业后期在外部完成。
11. **系统设置**：用户成员、Storage、Provider、Workflow Binding、备份与健康检查。

**无限画布排后**，但画布 Node 引用 `shot_id/asset_version_id/job_id`，不复制业务实体。后续加入 `Canvas/CanvasNode/CanvasEdge`，数据与镜头、资产库保持单一真相源。

## 13. 部署方案

### 13.1 Windows 开发 / 个人使用

- Windows 11 + Docker Desktop + WSL2，或本机 Python 虚拟环境运行 API 与 Worker、Vite Web。
- SQLite 数据放本机非 SMB 文件夹（例如 `D:\PulletStudioData\db\studio.sqlite3`）；Local 默认媒体目录另配；不建议把默认目录设在源码仓库下。
- 开发初期不要求 Redis、PostgreSQL、CUDA，`python -m pytest`、`npm run test`、`docker compose up` 需可复现。

### 13.2 NAS/Linux 私有团队部署

- Docker Compose：`web`、`api`、`worker`，可选 `media-worker`；SQLite 的 DB volume 指向宿主机可靠本地文件系统。NAS 直接装容器则 Project Media 用本机挂载；数据库务必考虑备份、文件系统和 WAL 稳定性。
- 如果采用多个 API 实例、独立多主机 Worker，切换 PostgreSQL+更成熟队列后再支持，V1 不宣称 SQLite 多主机分布式数据库。
- 自建 HTTP 入口前加反向代理 TLS；局域网仍做登录鉴权。公网部署需额外安全评估、HTTPS、可信代理、备份、限流和最小权限。

### 13.3 我们现有硬件适配

- 保留第一台 `G:\AICluster\ComfyUI_windows_portable` 不动；Studio 只新增一个 ComfyUI Connection 指向 Master `http://<实际局域网IP>:8188`。
- 飞牛 NAS `\\192.168.0.116\团队文件-AIStudio` 只是**我们部署时的示例 Storage Connection**，不可硬编码进产品默认值。
- 已有 Master 插件 ComfyUI-Distributed；Worker 扩展由该插件管理；Pullet Studio 不直接控制 7 台独立 16GB GPU 的显存或模型缓存。
- 分布式模式在真正接入第二台 Worker 并验证 `/distributed/queue` 后才标注为可用；插件版本升级后做契约回归测试。

### 13.4 备份恢复

- SQLite 使用在线备份 API / `VACUUM INTO` 一致快照；备份到另一可靠存储并定期做恢复演练；不能在运行时简单复制 `.sqlite3` 主文件当作可靠备份。
- 项目文件与 DB 必须按一致性窗口备份，备份 manifest 标注各对象是否完整；加密备份、密钥单独管理。
- `.env` 不入库不入 Git，凭据轮换；默认不把 API Key 备份为可公开文本。

## 14. 安全与对外产品最低要求

- 首次启动创建管理员；无通用默认密码。
- Argon2id、登录速率限制、会话注销/撤销、验证码/2FA 可后续加。
- 所有 API 后端 workspace/project 授权；不能靠前端工作区 ID 或文件路径；审查 IDOR。
- Provider 凭据加密存储并具 master key/secret manager，前端不可读；日志脱敏。
- 任意用户不可输入宿主服务器存储绝对路径；Local/NAS 根目录仅管理员配置；路径规范化、符号链接逃逸检查、存储隔离。
- 外部 HTTP 端点通过管理员审批的 allowlist；对外 URL 抓取有 SSRF 防护，阻断 metadata service、内网 IP、DNS rebinding，例外内网 ComfyUI 连接使用单独受信配置。
- 上传限制大小、媒体探测、磁盘配额；代码执行和自定义插件仅管理员可安装。
- 数据导出审计；项目可移植；隐私、模型许可证、外部服务条款、内容标识由部署者遵守。

## 15. 里程碑与详细交付门禁

### M0：仓库清查与技术基线（**必须先做**）

- 审计旧 ZIP、Codex 当前仓库和已有代码，确认使用 FastAPI 还是存在需保留的 NestJS 已实现逻辑。
- 写 ADR-001 选型、ADR-002 数据库、ADR-003 Provider/Storage。统一 lint、format、typecheck、tests、CI、`.env.example`。
- 建立 `api/web/worker` 最小可启动工程，SQLite 迁移与健康检查。
- **验收**：新环境一键依赖安装；API `/health`、Web 首页可访问；Alembic upgrade/downgrade 测试；CI 基础通过。Git commit。

### M1：账号、Workspace、项目、剧本底座

- 安全管理员初始化、登录/退出、邀请成员、角色权限；项目、ProductionUnit、Shot CRUD，ScriptDocument/Revision 导入、锁定、原文定位；Local 上传浏览。
- **验收**：3 个用户同工作区、不同权限；工作区 A 无法访问 B；重启数据保留；版本冲突返回 409；锁定剧本不能静默覆盖；3 种项目模板能创建。Git commit。

### M2：文本 Provider + AI 剧本分析与分镜

- OpenAI-compatible TextProvider（适配云端/本地，声明工具/结构化输出兼容性）、PromptProfile、AnalysisRun、Proposal、Pydantic schema、分层拆解、草案审核、完整镜头卡、PromptCompiler、导出 Markdown/JSON/CSV。
- **验收**：《盘古》定稿导入，AI 给出叙事结构与镜头草稿，所有引用可追溯到原文；用户拒绝/修改后可重新编译提示词；无模型时也可手动编辑和导出；都市悬疑和广告两套测试通过。Git commit。

### M3：Media + Storage + Generation Provider

- Local/Mounted Storage，安全导入和下载、媒体缩略图、FFprobe；ComfyUI 标准 Provider（Z-Image 图片 + Wan2.2 视频 Workflow Binding）、本地队列、结果导入、Take 版本。手工素材导入。
- **验收**：分别生成图片和视频、正确存储到用户选择的路径；后台重启任务可恢复；网络超时不双重提交；手工导入的即梦文件可关联镜头。Git commit。

### M4：团队生产流程 + 预演与导出

- Shot 分工、审核、评论、多 Take 选片、声音素材与原声策略、轻量故事板/可选FFmpeg预演、标准媒体与镜头清单交付。声音/字幕附件按来源和权限渐进接入，不开发剪辑器。
- **验收**：团队共同制作《盘古》 30–60 秒的完整预演样片，原声策略正确，选择不同 Take 不丢旧素材，镜头审核日志可查。Git commit。

### M5：系列化、第二 Provider、正式私有部署

- 系列跨集角色/场景引用、另一个非 ComfyUI 的**有正式公开接口**的 Provider、S3 Storage、Project Export/Import、备份恢复、NAS/Windows Compose 文档、权限安全审计。
- **验收**：跨两集角色资产复用；同镜头可在两个 Provider 间切换；本地→NAS/S3 搬迁不改业务引用；重装可恢复项目；至少 2 位真实测试用户完成一次制作。

### M6（V1.5/V2）：Agent、无限画布、长片生产增强

- 多 Agent 分工、RAG/Story Bible、跨段一致性检查、Yjs 同文档编辑、React Flow 画布、经逐软件验证的OTIO/FCPXML交接、云版及 PostgreSQL 正式迁移。复杂剪辑时间线不属于Pullet范围。
- **验收**：模拟 80 分钟工程结构、数百镜头的性能和权限测试；不要求真的本地生成完整电影才判定架构可用。

## 16. 质量门禁与测试矩阵

**单元**：SourceSpan、Prompt 编译、Provider capability/schema、路径清洗、镜头顺序、审核状态机、租户授权。

**集成**：SQLite WAL 并发、Alembic 升降级、幂等任务、Worker 重启租约回收、Storage 失败补偿、虚假 Provider/ComfyUI API Mock、S3 模拟（引入后）。

**端到端**：初装→注册/邀请→创建项目→导入剧本→生成草案→审核→生成/上传素材→归档→Take→预演→导出；三用户角色访问不同资源；未登录/无权限/越权访问必须失败。

**故障注入**：外部模型 429/500/超时、提交超时但上游已接单、上游历史清理、NAS 宕机、半文件、磁盘满、API 重启、Worker 异常退出、重复回调/重复输出、错误模型参数、不可取消任务、存储迁移中断。

**性能基线建议（测试目标不是实际结果）**：至少 100 项目、1000 角色/场景资产、10000 镜头、100000 任务记录可分页浏览；按实际硬件逐步压测，记录 API p95、SQLite 锁等待、文件导入吞吐和缩略图生成时间。达不到则优化索引/分层或升级 DB，不宣称未经测量的性能保证。

## 17. 开发和发布规则

1. 每个阶段先给出改动文件、API/Schema 差异、迁移步骤与测试计划，然后实施；不允许“先写大量功能再补测试”。
2. 禁止直接复制 AGPL、非商业或未知许可证源码；可以学习架构模式，实现新代码；引入依赖记录许可证与版本。
3. 所有版本升级应提供 `CHANGELOG`、数据迁移、备份/回滚和兼容说明。
4. 任何已批准的剧本、镜头、Take、媒体资产都不可被自动任务覆盖。
5. 业务代码不出现 `192.168.0.116`、`G:\AICluster`、`/prompt`、特定模型 `wan2.2` 等硬编码常量。ComfyUI 路由只出现在其 Provider 实现与配置中。
6. 任何模型 Provider 可被移除，但历史任务和导入的素材继续可访问。
7. 强调真实可用功能：按钮不能只是 demo 却显示生产成功；未实现能力需禁用并明确标记。
8. 用户数据默认私有；默认不接第三方统计追踪，不上传剧本到未选择的模型服务。

## 18. Codex 首轮执行清单（M0）

**任务必须顺序完成：**

1. 扫描当前工程目录与 Git 状态；检查是否存在用户已实施的 NestJS 业务代码，不覆盖。列出可复用与需替换模块。
2. 确认主后端选型；如果仅有原始 NestJS 空壳，创建 FastAPI 主后端，并把旧代码归档，保留 React 前端。
3. 写 `docs/ADR-001-stack.md`、`ADR-002-database.md`、`ADR-003-boundaries.md`，本文为约束来源。
4. 建 Python 项目依赖、`ruff`、`pytest`、FastAPI `/health/live`、`/health/ready`；SQLAlchemy async SQLite engine，PRAGMA per connection，Alembic 初始迁移。
5. 建 Web 最小布局、API 健康提示、路由、TypeScript 严格类型；不要先做无限画布。
6. 建本机 Docker Compose（web/api/worker），SQLite DB 在持久化卷，默认 Storage 为 Local，所有端口可环境变量配置；提供 Windows & Linux 开发命令。
7. CI 跑 Python/前端 lint、typecheck、测试、迁移测试；保证空环境可以从 README 复现。
8. 输出：实施说明、命令输出、通过/未通过测试、风险清单、Git commit；遇到阻塞必须给出可重现错误，不得伪称通过。

**M0 完成前，不开发复杂业务或更换框架。**

## 19. 对外可用的文档清单

- 用户安装、第一管理员 Setup、Workspace/用户权限、项目制作教程。
- 模型 Provider 连接教程：标准 ComfyUI、Distributed、OpenAI-compatible text；含版本说明。
- Storage 教程：Local、NAS 挂载与权限、S3 后续。
- API OpenAPI 文档、导入导出格式、迁移与备份。
- 安全部署清单（LAN/HTTPS、凭据、访问控制、数据与版权）。

---

## 20. 关键决策总结

**我们要做的是“剧本驱动、镜头管理、可插拔 AI 服务与存储、多人协作的影视创作系统”，不是一台 GPU 管理服务器。**

产品既能制作《盘古》旁白长视频，也能制作 30 秒广告、3 分钟短剧、多集漫剧以及 80 分钟电影；差异通过项目模板、导演 Profile、声音/时长与制作流程配置，不复制四套业务代码。

V1 首先完成有用的生产闭环：**导入剧本 → AI 分镜草稿 → 人工审核 → 完整提示词 → 生成/手工导入 → Take → 简易预演 → 导出**。ComfyUI/NAS 只是用户可选的基础设施插件。
