> 历史快照，2026-11-05整理时归档；功能状态与任务顺序已过期，不能直接按本文施工。当前入口：[文档导航](../../README.md)、[实施状态](../../IMPLEMENTATION-STATUS.md)。原正文保留，仅调整Markdown相对链接和行尾空白。

# 数据模型及 API 合同（V1 设计；实现范围见 IMPLEMENTATION-STATUS.md）

本轮制作结构/项目四轴的已实现合同见 `PRODUCTION-STRUCTURE.md`；复用 episodes 物理存储的增量兼容决策见 ADR-004。下文未来表/接口不代表已实现。

文本连接/模型、分析任务/草案及状态 API 已实现，精确合同见 `TEXT-ANALYSIS.md`；媒体生成任务、正式审核/提示词/Take 等未来设计仍未实现。

## 1. 核心表
所有业务主键 UUID/ULID；人类可读 code 不做主键。时间 UTC 存储，UI 本地化。

| 表 | 关键字段 | 约束/说明 |
|---|---|---|
| users | id,email,passwordHash,status | email 唯一；无开放注册默认 |
| workspaces | id,name,slug,createdBy,nextProjectNumber | slug 实例内唯一；项目编号计数器在创建事务内更新 |
| workspace_members | workspaceId,userId,role,status | 唯一(workspaceId,userId) |
| projects | id,workspaceId,code,title,aspectRatio,language,stylePreset,styleDescription,nextEpisodeNumber,version | 唯一(workspaceId,code)；version 乐观锁 |
| project_members | projectId,userId,role | 项目内附加授权 |
| scripts | id,workspaceId,projectId,version,createdAt,updatedAt | 每项目一份项目剧本，指向最新版本 |
| script_revisions | id,scriptId,workspaceId,projectId,version,title,content,summary,createdBy,restoredFromVersion,createdAt | 唯一(scriptId,version)；数据库触发器禁止修改和删除历史 |
| episodes | id,workspaceId,projectId,code,title,orderIndex,nextShotNumber,status,version | 唯一(projectId,code) |
| shots | id,workspaceId,projectId,episodeId,code,sequence,description,durationHint,version | 唯一(episodeId,code) |
| production_assets | id,workspaceId,projectId,type,name,metadata,version | 角色/场景/道具业务卡 |
| media_assets | id,workspaceId,projectId,storageObjectId,type,sha256,mime,provenance | 具体图片/视频/音频 |
| asset_relations | sourceAssetId,targetAssetId,relationType | 参考图/复用关系 |
| storage_configs | id,workspaceId?,kind,configEncrypted,status | workspaceId 为空是 system 级 |
| storage_objects | id,storageConfigId,key,sha256,size,state | key 唯一(storageConfigId,key) |
| provider_endpoints | id,workspaceId?,providerType,url,credentialsEncrypted,status | 管理员可信配置 |
| model_profiles | id,endpointId,capability,name,parameterSchema,version,enabled | 可绑定不同版本 |
| workflow_profiles | id,modelProfileId,version,workflowJSON,bindingsJSON,sha256 | ComfyUI 可选；不可覆盖版本 |
| generation_jobs | id,workspaceId,projectId,shotId?,modelProfileId,idempotencyKey,state,externalJobId?,requestSnapshot | 唯一(workspaceId,idempotencyKey) |
| generation_outputs | jobId,outputIndex,mediaAssetId | 唯一(jobId,outputIndex) |
| takes | id,shotId,jobId?,label,status,isSelected,createdBy | 镜头多个 Take |
| take_assets | takeId,mediaAssetId,role | 一个 Take 多文件 |
| reviews | id,takeId,reviewerId,decision,comment,createdAt | 全历史 |
| audit_events | id,workspaceId,actorId,action,targetType,targetId,metadata | 关键操作审计 |
| outbox_events | id,kind,payload,processedAt?,attempts | DB→Queue 可靠转交 |

### 数据校验
- 子对象需验证 projectId/episodeId/shotId 在同一个 workspace 和父链。
- takes.selected 必须保证同 shot 最多一个 selected，可以使用部分唯一索引。
- 工作区隔离由服务端 AuthZ + 所有读写查询的 workspace 限定实现；当前 SQLite 通过复合外键约束父链。未来 PostgreSQL 可另行评估 RLS，不依赖它代替业务授权。
- 数据库不得直接保存明文 Token、完整带签名的媒体 URL。

## 2. API 规划
基路径 `/api/v1`；JSON + OpenAPI；分页采用 cursor；编辑写操作带 `expectedVersion` 或 `If-Match`；错误统一 `code,message,requestId,details`。

### 身份/工作区
- POST /setup/initialize (仅首次、一次性管理密钥)
- POST /auth/login；POST /auth/logout；GET /auth/me
- GET /setup/status；POST /workspaces/:id/invitations；POST /invitations/accept
- GET/POST /projects/:id/members；GET /projects/:id/access
- GET/POST /workspaces；GET/POST /workspaces/:id/members
- GET/POST /workspaces/:id/storage-configs（管理员）
- GET/POST /workspaces/:id/provider-endpoints（管理员）

### 项目内容
- GET/POST /projects；GET/PATCH /projects/:id
- GET/POST /projects/:id/episodes
- GET/PATCH /episodes/:id；GET/POST /episodes/:id/shots
- GET/PATCH /shots/:id
- GET/POST /projects/:id/production-assets
- GET /projects/:id/media-assets

### 自动标识（已实现）
根据用户明确偏好，工作区标识和项目/分集/镜头编号都由后端生成，创建和编辑 API 不接受客户端的 `slug`/`code`。工作区创建体为 `{name}`，slug 为 `ws-<UUID>`。项目、分集和镜头分别在 `BEGIN IMMEDIATE` 事务中使用父级计数器分配 `P0001`、`EP01`、`SH001` 等编号。计数器更新、业务对象和审计一起提交；跳过旧数据已占用的值，不因改名或排序重编编号。UUID 主键继续由后端生成。

### 项目视觉风格（已实现）
项目创建与修改接受 `stylePreset` 和 `styleDescription`。预设取值：`unspecified`（默认）、`cinematic_realism`、`animation_3d`、`animation_2d`、`ink_wash`、`custom`。描述默认空字符串，先去除首尾空白，最长 2,000 字符；选择 `custom` 时有效描述不能为空。部分更新时校验合并后的完整设定；修改其他项目资料不会清空风格。沿用项目管理权限、乐观锁和审计，风格不等同于题材、模型或工作流。

当前风格只保存为创作设定。后续任务请求需冻结实际采用的预设、描述和参考资产等信息；修改项目设定不追溯改写既有任务/Take。分集和镜头风格覆盖、参考图、Provider 参数映射尚未实现。

### 项目剧本（已实现）
本轮增加导入、明确锁定/解锁及原文定位，精确请求/返回合同见 `SCRIPT-IMPORT.md`。`script_sources` 保存有界来源原件；`scripts` 新增 lock_version/locked_at/locked_by，所有剧本写入口遵守锁定（HTTP 423）。旧接口继续可用，已保存正文与历史不改写。

- GET /projects/:id/script：最新剧本；尚未保存返回 version=0 的空内容，读取不创建记录。
- POST /projects/:id/script：`{expectedVersion,title,content,summary?}`，第一次保存 expectedVersion=0；title 最长 200 字符，正文最多 60,000 字符，说明最多 200 字符。
- GET /projects/:id/script/versions?before=版本号：每页最多 30 条，返回 `{items,nextCursor}`，列表不含正文。
- GET /projects/:id/script/versions/:version：只读历史版本全文。
- POST /projects/:id/script/versions/:version/restore：`{expectedVersion}`，从历史复制正文与标题并追加新版本；不回退或覆写旧记录。

剧本读取沿用项目访问权限，保存/恢复要求项目编辑权限。版本冲突返回 HTTP 409 和 `details.latestVersion`。版本新增、最新版本指针更新与审计在同一数据库事务里提交；项目/工作区复合外键限制关联父链。当前版本为每项目一份纯文本项目剧本；分集独立剧本与富文本后续扩展。

### 项目回收站（已实现）
- POST /projects/:id/trash、POST /projects/:id/restore：`{expectedVersion}`，需要项目管理权限。变更状态与版本递增、审计同一事务提交；旧版本或不匹配状态返回 409。
- GET /workspaces/:id/trash/projects?cursor=项目UUID：每页最多 100 条，按 ID 升序；工作区管理员可见全部，普通成员只可见担任项目管理的条目。

`projects.deleted_at`/`deleted_by` 记录软删除时间与操作者。普通项目列表排除软删除项目，所有普通项目、剧本及子资源读写接口返回 404；恢复不重编号、不清空内容。当前不自动清理且没有永久删除接口。

### 成员管理（已实现）
- GET /projects/:id/member-candidates：可分配的工作区成员，项目管理权限。
- GET /projects/:id/members：已分配项目成员及其工作区角色，项目管理权限。
- POST /projects/:id/members：`{userId,role,expectedRole?}`。首次分配不要求旧角色，改变已有角色须携带 `expectedRole`，过期角色返回 409。
- DELETE /projects/:id/members/:userId：`{expectedRole}`，移除该项目访问权。
- PATCH /workspaces/:id/members/:userId：`{expectedRole,role}`，新角色仅 `MEMBER` / `WORKSPACE_ADMIN`。
- DELETE /workspaces/:id/members/:userId：`{expectedRole}`，清理该工作区全部项目（含回收站）成员关系及相关未使用邀请；保留账户、署名及其他工作区成员关系。

工作区所有者禁止直接降级/移出，仅所有者可授予和管理管理员；管理员只可管理普通成员及邀请普通成员。工作区所有者/管理员已有隐式项目管理权限，项目角色分配/移除不能限制此权限。权限逐请求检查，不注销其他工作区仍使用的会话。成员角色条件更新、关系清理和审计在同一事务完成。

### 上传与预览
- POST /assets/upload-intents -> 受控上传会话
- POST /assets/upload-intents/:id/commit -> 校验并登记
- GET /assets/:assetId -> 元数据
- GET /assets/:assetId/content -> 权限校验后 redirect/stream；视频支持 HTTP Range
- POST /assets/:assetId/relations -> 建立业务关系

### 模型/工作流
- GET /generation/providers
- POST /generation/endpoints/:id/test (管理员)
- GET/POST /model-profiles
- POST /workflow-profiles/validate
- POST /workflow-profiles (带绑定映射和 workflowJSON)

### 生成
- POST /generation/jobs (Idempotency-Key 必须)
- GET /generation/jobs/:id
- POST /generation/jobs/:id/cancel
- POST /generation/jobs/:id/retry (新尝试、规则明确)
- GET /shots/:id/takes
- POST /takes/:id/submit-review
- POST /takes/:id/approve
- POST /takes/:id/reject
- POST /shots/:id/select-take

### 系统
- GET /health/live, /health/ready；GET /openapi.json；GET /events/ws (鉴权)

## 3. 生成请求示例
```json
{
  "projectId": "project_uuid",
  "shotId": "shot_uuid",
  "modelProfileId": "model_profile_uuid",
  "capability": "video.image_to_video",
  "prompt": "远古天空裂开一道光，镜头缓慢推进",
  "inputAssets": [{"assetId":"asset_uuid","role":"first_frame"}],
  "options": {"durationSeconds": 5, "seed": 123456}
}
```
业务只保存 Asset ID，不传客户端实际 NAS 路径。Backend 校验用户及资源权限，生成时按照 Profile Schema 校验 options。

## 4. ComfyUI Workflow Binding 示意
```json
{
  "workflowProfileVersion": 1,
  "workflowFileSha256": "sha256-of-api-workflow-json",
  "inputs": {
    "prompt": {"nodeId": "6", "inputName": "text"},
    "first_frame": {"nodeId": "12", "inputName": "image", "prepare": "upload_image"},
    "seed": {"nodeId": "21", "inputName": "seed"}
  },
  "outputs": [ {"nodeId": "45", "kind": "video"} ]
}
```
节点编号仅示意，导入的工作流必须由连接测试验证节点存在、输入类型合理、输出存在。工作流 JSON 在提交任务时克隆、填参；绝不修改已发布版本原件。

## 5. 异步回收与幂等策略
- API 接收 Job 请求时先用事务落 generation_jobs + outbox_events。
- Worker 从数据库持久化记录领取任务；outbox 用于可靠事件交付，未来也可转交队列适配器。通过租约与数据库 id/状态去重，不能使用仅驻留内存的任务列表。
- Provider submit 成功后先持久化 externalJobId。若调用成功但数据库写失败，进入需要人工或供应商幂等查询的恢复流程，不盲目再次提交收费生成。
- Poll Worker 检测完成后把 ResultDescriptor[] 交 Ingestion Worker。
- Ingestion 对每个 outputIndex 使用唯一键，避免重试创建重复资产。
- Asset 在 Storage staging 校验完整后 publish；DB 事务关联 Take 与元数据；孤儿 staging 由后台清理任务扫描。

## 6. Storage Provider 约定
putStream/getStream/stat/delete/list (管理用途)、capabilities；签名直传/下载可选。`storageId + objectKey` 由后端生成；storageId 修改不得破坏历史资产。迁移是复制→校验→切换引用→延后删除，不修改资产 ID。
