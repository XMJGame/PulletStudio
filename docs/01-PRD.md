# Pullet Studio V1.0 产品需求规格（执行基线）

版本：0.1 / 2026-11-04 / 状态：开发基线草案

## 0. 一句话产品定义
Pullet Studio 是可私有部署的、面向个人和团队的 AI 影视创作与生产平台。管理故事、分集、镜头、资产、生成、审核和交付；生成引擎与存储由用户配置，不要求 ComfyUI、NAS 或任意特定云服务存在。

## 1. 不可变架构原则
1. **生成引擎无关**：业务对象不依赖 ComfyUI 节点编号，不存储特定服务的永久 URL 作为资产主键。
2. **存储无关**：默认可用本地磁盘；NAS 是挂载文件系统的一种部署；支持 S3 兼容存储；CDN 是分发层而非主存储。
3. **工作区隔离**：实例可服务多个 Workspace。所有项目、资产、任务、配置按 Workspace 授权，绝不只信任前端传来的 workspaceId。
4. **创作与生成分离**：没有任何模型服务时，项目管理、剧本编辑、资产上传、镜头审核仍可用。
5. **生产输出可追溯**：保存提交时的实际参数快照、工作流版本、模型 Profile、服务任务 ID、输出文件校验、来源和审核记录。
6. **原始资产不可变**：新生成结果始终新建 Asset 和 Take，不覆盖被审核通过的对象。
7. **先模块化单体**：Web + NestJS API + SQLite 起步，异步 Worker 后续加入。首版不强依赖 PostgreSQL/Redis；扩展时根据写入并发与部署需要另行实现，不做过早微服务拆分。
8. **外部 GPU 集群独立**：Studio 只连接 ComfyUI Master/其他 Provider；不控制内部显卡与 Distributed Worker。
9. **可移植**：Windows、Linux、NAS Docker 一套镜像；不写死 Windows 盘符、UNC IP 和 NAS 名称。
10. **版权合规**：素材来源、许可证、授权范围、生成模型版本有可选结构化记录；不是自动保证商业合规。

## 2. 用户/部署对象
- Personal：单人自部署，默认 Local，手动上传素材，也可云 API 生成。
- Team：3-20 人私有化部署，NAS 或 S3 共用媒体，团队独立角色权限。
- Cloud-ready：保留租户隔离、配额和审计扩展点，但 V1 不提供公有 SaaS 计费。

## 3. V1 范围（首发必须）
- 安装初始化：管理员创建、工作区创建、系统本地存储根目录设置、工作区配置。
- 用户团队：邀请用户、工作区角色、项目成员、最小 RBAC。
- 项目：基础资料、画幅、语言、风格描述、状态、封面、成员。
- 影视结构：剧本/章节、Episode、Shot（镜头号、顺序、时长、画面描述、运镜、对白/旁白）。
- 资产库：上传导入、人物/场景/道具卡片、参考图、标签、版本、关联 Shot。
- 生成：Provider/Endpoint/Model Profile；能力参数 Schema；提交生成任务；状态查询；结果导入为 Asset/Take。
- ComfyUI Adapter：API 工作流 JSON 导入、手工节点字段绑定、运行验证、输入图片上传、提交、查历史、读取输出。
- 文件服务：本地文件存储；已挂载 NAS 目录；S3 接口；读取鉴权；缩略图与视频在线播放（Range）。
- 审核：Take 送审、通过/驳回、评论、最终版本固定；历史可审计。
- 任务中心：排队、状态、取消（尽力而为）、重试（安全范围）、错误原因、任务恢复。
- 多人：多人同时操作不同镜头、WebSocket 状态通知、编辑并发冲突保护。
- 项目导出：素材清单 JSON + 工作流快照 + 选中 Take；文件打包可作为后续增量。

## 4. 非 V1（保留架构但明确不做）
- 一键小说→自动完成所有剧集。
- 成熟的 AI Agent 编排和自动考据；后续可接文本 Provider。
- 无限画布的完整执行 DAG、多人 CRDT 同编。
- 完整剪辑 NLE、变速调色、多轨混音；交给专业工具。
- GPU 显存合并、Distributed Worker 管理、模型自动缓存到各 Worker。
- 云 SaaS 多地域弹性伸缩、支付会员、商店、公开模型市场。

## 5. 业务对象定义
Workspace > Project > Episode > Shot；Project 另有 ScriptDocument、Character、Scene、Prop、Asset；Shot 关联多个 Job/Take；Take 可由一个或多个 Asset 构成；审核针对 Take 并记录决策。Canvas（后续）只引用业务对象 ID，不复制业务实体。

### Shot 例
- code = SH008；shotType = medium；durationHintSeconds = 5；description = 女娲看向裂开的天空
- prompt / negativePrompt / referenceAssets[] 是项目数据，不直接映射到特定模型字段
- generationConfigRef 是可选默认配置；每次提交需冻结实际快照

## 6. 典型完整流程
1. 系统管理员创建工作区，配置 Local 默认存储、可选其他存储和 Provider。
2. 项目制片创建项目、分集、镜头，邀请编剧/美术/生成师/导演。
3. 美术上传并确认人物定妆图，建立 Character→Reference Asset 关联。
4. 生成师选择 Shot + Provider Model Profile，配置参数、参考图，提交 Job。
5. 队列 Worker 根据配置调用外部服务；周期查询任务状态；把结果抓取到服务端临时盘。
6. 安全校验、hash、媒体探测、上传主存储；建立 Asset + Take，原始生成参数保留。
7. 导演审核，审批通过或退回重做。通过的 Take 标记为该 Shot 的 selectedTake。
8. 项目导出镜头资产清单、文件及元数据，去剪辑软件完成成片。

## 7. 权限与协作
RBAC：INSTANCE_ADMIN、WORKSPACE_OWNER、WORKSPACE_ADMIN、PROJECT_MANAGER、EDITOR、GENERATOR、REVIEWER、VIEWER。角色是权限集合；工作区身份和项目参与关系均需核验。生成 Provider 的 API Key 只可由有权管理员新增/轮换，不可被普通用户读回。项目删除走回收站并有保留期。

并发：普通表单乐观锁 version（冲突返回 HTTP 409，提供服务器最新版本），任务结果发布在事务里确认所属项目和权限。任务状态通过 WebSocket 推送，但最终状态以数据库为准。

## 8. 质量标准与验收
- 不配置任何 AI Provider：可以新建项目、剧集、镜头并上传图片。
- 3 个账户并行操作同一工作区不同镜头；查看者无法改动数据；跨工作区 403/404。
- ComfyUI 任务提交与结果归档跑通，包括单图、单视频，失败和超时有错误日志。
- 同一镜头同时保留 3 个 Take，选中 1 个、其他不丢失；批准版本不可被覆盖。
- 支持 Local→S3/NAS 的媒体迁移演练，源文件直到校验完成前不删除。
- 重启 API/Worker、断开外部 Provider、断开存储时，不能丢失任务关系或生成结果。
- 业务 API 最少具备自动化鉴权、租户隔离、对象越权、文件路径穿越测试。

## 9. 产品体验原则
默认界面先用分集列表、镜头卡片、生成抽屉和资产库。模型专有参数通过 Profile Schema 动态展示；高级用户可导入 ComfyUI API 工作流；避免一开始强制用户理解 ComfyUI 节点。
