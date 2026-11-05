# Pullet Studio V1.0 架构规范

> 产品边界见[ADR-009](ADR-009-production-and-postproduction-handoff.md)：统一生产核心支撑生产工作台和创作画布；保留媒体处理/轻量预演，交付固定原件、镜头清单、版本及来源。正式多轨剪辑、转场、关键帧、调色、合成、专业混音交外部工具，OTIO/FCPXML另做具体软件兼容验收。

## 1. 技术栈决定
- React + TypeScript + Vite：SPA 创作界面。
- Tailwind + shadcn/ui：组件库；TanStack Query 服务端状态；Zustand 仅做本地 UI 状态。
- React Flow / @xyflow/react：后续画布，仅作为业务对象的可视化视图。
- NestJS：模块化单体业务 API、鉴权、WebSocket 通知和 Provider 注册。
- SQLite：当前业务实体、会话及审计；启用 WAL、busy timeout、外键、事务、唯一约束、乐观锁。数据库放后端主机本地持久化磁盘。
- Drizzle ORM：TypeScript schema、SQL migrations；择一 ORM，不混用 Prisma。
- M3 默认计划使用数据库持久化任务调度，独立 Worker 通过短事务、租约和条件更新领取任务；执行者必须幂等。Redis/BullMQ 可作为未来调度适配器，不是当前依赖，尚未实现。
- FFprobe/FFmpeg：媒体探测、缩略图、封面、必要时转码；作为独立 Worker 任务。
- 对象存储：Local FS 作为默认实现；Mounted FS 复用；S3-compatible 作为标准实现；OSS/COS 可使用兼容接口或独立适配。
- Python AI Agent 后置：真正需要高级编剧工作流时才引入独立服务。

## 2. 进程与信任边界
```
Browser -> Reverse Proxy -> NestJS API -> SQLite (future: PostgreSQL adapter)
                        |-> Persistent Job Store -> Worker -> Provider Endpoints (ComfyUI, Cloud API, TTS)
                        |                           -> Asset Ingestion -> Storage Adapter
                        |-> AuthZ, audit, signed-file gateway
Browser <- WebSocket/SSE status notifications
```
API、Worker 和存储适配器在同一后端代码库，单独进程启动；Worker 重启不应影响 Web API。用户永远不能控制服务端任意文件路径、内网目标 URL 或 shell 命令。

## 3. Monorepo
```
apps/web           React 前端
apps/api           NestJS API
apps/worker        持久化任务执行者（后续建立）
packages/contracts DTO/JSON Schema 和跨端类型
packages/provider-sdk Provider 接口（后续建立）
packages/storage-sdk  Storage 接口（后续建立）
infra               Docker Compose、容器配置和迁移
docs                需求、架构、API、实施计划
```

## 4. Provider 抽象：禁止硬耦合
Provider 是连接类型（comfyui, cloudVendorX）；Endpoint 是实例/凭据/URL；ModelProfile 是产品化能力，支持 image/video/speech/audio/text 等 capability；WorkflowProfile 是 ComfyUI-specific 可选对象。

接口语义：
- capabilities(): 返回模型支持的功能、输入/输出类型、参数 JSON Schema、限制。
- submit(request): 返回 ExternalJobRef；不得直接假设同步成功。
- poll(ref): 返回 queued/running/succeeded/failed/unknown 状态与进度。
- cancel(ref): best-effort 并声明是否支持。
- results(ref): 返回受控 ResultDescriptor[]，包括可下载链接、文件ID、字节流代理、格式和有效期。
- health(): 连接探测，不等于具备所有模型。

业务 Request 统一字段为 prompt、negativePrompt、inputAssetIds、capability、profileId 与基于 schema 的 options；引用文件由 AssetGateway 在提交前按 Provider 接口准备。

对于 ComfyUI：手工导入 API JSON，绑定 nodeId + inputName + transform；每次提交保存 workflowJson hash/version、实际 workflow 快照；POST /prompt 得 prompt_id，GET /history/{prompt_id} 查询输出，GET /view 获取媒体，参考图通过 /upload/image。Master 是否调度到 Distributed Workers 由内部插件和工作流决定，Studio 不假定。不得从 history 盲目认为所有文件都可读或都属于某个镜头。

## 5. 任务持久化状态机
Draft -> Queued -> Preparing -> Submitted -> Running -> Ingesting -> Completed
失败可发生在任意中间阶段，记录 Failed(reason,retriable)；用户可 CancelRequested -> Canceled 或仍 Completed（外部不支持取消时）。

核心字段：id, workspaceId, projectId, shotId?, takeId?, providerEndpointId, modelProfileId, workflowVersion?, idempotencyKey, externalJobId?, state, requestSnapshotJSON, attempts, timestamps, errorCode, errorMessage。

幂等设计：一次 Submit API 带 idempotencyKey；同一 workspace + key 唯一约束；数据库先落库再通过 outbox / 定期 reconciliation 入队；外部已提交但本地异常时按 externalJobId 恢复，无法确认时标记 NeedsAttention，不自动生成第二份；素材导入按 (jobId, outputIndex, sha256) 去重；外部重试须理解供应商计费风险。

队列消费不保证 exactly-once；不要因为队列重试就重复调用付费模型。Worker 通过短事务原子领取任务并持有租约，网络请求不得在数据库写事务内等待。必须读取数据库状态、校验转移；重启后恢复扫描处理卡住状态。图像、视频、音频分别限制执行并发；租约超时不能当作重新提交收费生成的依据。

## 6. 存储抽象与文件安全
- storage_config：id, scope=system/workspace, kind=local|mounted|s3, encryptedCredentials, root/bucket, status。
- asset：id, workspaceId, mediaType, sha256, size, mime, metadata, storageObjectId, provenance, createdBy。
- storage_object：id, storageId, key, state=staging|ready|deleting, sha256, bytes, contentType。
- signed access：授权后预签名直传/下载或受控文件网关，注意防止绕过 workspace RBAC。
- key 在后端生成，与用户上传文件名分离；禁止 ../ 路径穿越和符号链接逃逸。
- 防 SSRF：下载外部结果 URL 只能访问 allowlist 范围或经可信 Provider 结果接口，拒绝私网/回环/元数据地址、跳转重新校验、限制体积与时间。
- 流式处理大型视频，文件先写隔离 staging，计算 hash、媒体探测后正式发布；数据库入库失败留待 recovery/reconciliation，不先删 staging。
- 主存储不自动等于备份。备份数据库、media 对象和配置密钥必须一起演练恢复。
- CDN 为 Delivery 配置，不能当作 storage_object 的稳定标识。

## 7. 多租户安全
- JWT cookie（HttpOnly, Secure, SameSite）或同等安全会话；CSRF 保护，短生命周期、轮换和注销。
- 每个业务查询以登录用户的 workspace membership 判定；重要对象查询同时校验 project membership。
- workspaceId 和 projectId 是过滤条件，不是授权依据；统一 authorization service。
- 外部 Provider 地址、NAS 配置路径属于管理员信任边界；普通成员不得自由输入服务器端任意目标。
- 生产环境配置 CORS 精确域名、反向代理 HTTPS、请求限速、上传大小限制、配额与审计。
- 默认禁用开放注册：首位管理员由一次性初始化流程创建；邀请制后扩展自注册策略。

## 8. 部署模式
- Personal：Node.js + SQLite，Local 主存储，默认只监听 localhost；当前无需 Docker。
- Team：计划支持同一后端主机上的 API/Worker 与本地 SQLite，媒体映射 NAS 已挂载目录或 S3。受信任局域网经 Nginx/Caddy 反代 HTTPS，需另行部署验收；多人写入吞吐由实测决定。数据库不跨机器共享文件。
- Cloud：S3 + CDN，数据库托管，更多监控与租户隔离；不在 V1 实现 SaaS 运营功能。
- Windows Docker Desktop：WSL2 卷使用 Docker/Linux 持久化卷，NAS SMB 共享需宿主机/容器明确挂载并测试权限，不能假定 G: 自动可见。
- fnOS NAS：需先检查 CPU 架构、Docker Compose、可用内存、磁盘 IO；不要在 NAS 上运行不必要的大规模 FFmpeg 转码。

## 9. 可观察性
traceId/jobId/assetId/providerRef 关联全链路结构化日志；队列长度、模型服务错误率、存储失败率、任务从排队到完成时间、媒体归档滞留量和资源成本。API Key、用户素材正文、签名 URL 不写入日志。

## 10. 架构决策记录
ADR-001 不将 ComfyUI 作为系统强依赖。
ADR-002 不将 NAS 作为系统强依赖。
ADR-003 选 React + NestJS + Drizzle，2026-11-04 根据用户决定改用 SQLite 起步；PostgreSQL 后续实现，Redis/BullMQ 不作首版强依赖。
ADR-004 Storage 路径由 StorageAdapter 封装，资产引用统一 ID。
ADR-005 工作区与项目权限自第一版落地。
ADR-006 Distributed 属于外部 ComfyUI 集群，不由 Studio 调度 GPU。
ADR-007 工作流参数绑定使用版本化 node/input 映射，禁止用户上传的 workflow 在服务端执行任意程序。
ADR-008 初期不做多人同时编辑同一段文本的 CRDT；用乐观锁保护业务记录。

ADR-009 保留已有 NestJS 实现。借鉴 Core/Application/HTTP 的依赖方向；不因参考项目使用 Python 而重写已验收的身份与权限代码。需要 Python 模型工具时通过 Provider/独立执行模块接入，不维护第二套业务后端。

ADR-010 PostgreSQL 的未来支持需要独立 schema/migrations、仓储边界和数据迁移验证；Drizzle 本身支持两种方言不等于应用可以更换连接串即切库。
