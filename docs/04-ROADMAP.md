# 实施路线与 Codex 工作拆单

> 2026-11-04：本文保留既有开发历史。完整产品基线改为 `MASTER-PLAN.md`；最新现状、依赖顺序、阶段门禁及遗留问题以 `IMPLEMENTATION-STATUS.md` 为准，不再按本文旧 M2 存储优先顺序施工。

> 2026-11-05：ADR-009收紧为AI影视生产与后期交接；简单预演可选，专业剪辑器取消。声音/字幕交付按真实来源推进；工程交换格式后置验证。现有代码保留，不以旧路线继续新增剪辑器能力。

## M0 基础环境
- [x] 产品需求与架构约束文档
- [x] 数据实体、API 和状态机设计草案
- [x] 仓库目录/开发基础设施骨架
- [x] 在当前 Windows 安装依赖，验证构建、接口与浏览器流程
- [x] 设置 SQLite/Drizzle 版本化数据库 migrations 与首次管理员初始化
- [ ] Linux/NAS 部署与恢复演练（后续交付阶段）

**当前为 M1 基础版本，完整 V1 功能尚未交付。详见 `05-DEVELOPMENT.md`。**

## M1 用户与项目（第一个真实可用里程碑）
1. 确定 Drizzle schema（users, workspaces, memberships, projects, episodes, shots），建立迁移。
2. 首次管理员 bootstrap，登录、HttpOnly cookie 会话、CSRF/CORS、密码安全、邀请成员。
3. Workspace/Project RBAC Guard，统一后端权限服务，跨租户测试。
4. 项目/分集/镜头 REST API + React UI，所有写操作乐观锁；列表排序。
5. Playwright/接口测试覆盖 3 名用户协作、越权和 409 冲突。
完成定义：无 Provider 也可多人登录、分配项目、创建和编辑分集镜头，重启后数据不丢。

2026-11-04：基础协作与编辑流程、自动编号、视觉风格、剧本版本历史、项目回收站与恢复、项目/工作区成员角色调整及移出已通过接口与浏览器验收。下一步进入 M2-A 本地素材上传与预览；完整 V1 仍需生成、审核与部署验收。

## M2 Storage（第二里程碑）
1. LocalStorage 实现，管理员限定根目录，防路径穿越和符号链接逃逸。
2. Upload Intent、分块/流式上传、SHA256 校验、媒体探测和缩略图。
3. Asset Registry、媒体元数据、权限读取、视频 Range 播放。
4. Mounted NAS 路径支持（配置，不写死任何 UNC）。
5. S3CompatibleStorage；Mock S3/MinIO 测试，模拟网络中断和孤儿 staging。
完成定义：个人本地与团队 NAS/S3 都能导入、预览、保存和重新启动后访问同一批素材。

## M3 Provider（第三里程碑）
1. Provider SDK：能力 Schema、submit/poll/results/cancel、异常分类和连接探测。
2. GenerationJob、Outbox、数据库持久化 Worker、租约、状态机、状态推送；首版不强依赖 Redis。
3. ComfyUI 工作流 JSON 手工绑定、校验/版本固定。
4. 第一台本地 ComfyUI Master 连通，Z-Image 文生图与 Wan2.2 视频工作流分别验证。
5. Result Ingestion：存储、去重、创建 Asset + Take。
完成定义：从 Shot 点击生成，输出自动进入正确项目镜头；中断重启可恢复。

## M4 生产与审核（V1.0 目标）
1. 人物、场景、道具资产卡、参考图和关联。
2. Take 多版本列表、选中、审核、退回、评论、锁定批准版本。
3. 简单任务分配、状态通知、导出镜头清单和媒体。
4. 第二个非 ComfyUI Provider 的适配实例（选有正式 API 的服务）。
5. 端到端验收：3 人、2 集、共 10-20 镜头、多来源生成、权限隔离、NAS/S3。
完成定义：完整生产一段可交付短片素材，数据可备份和迁移。

## M5 之后（不阻塞 V1）
- AI 编剧 Agent：全剧分析、分集、人物场景提取、人工确认；模型自由选择。
- React Flow 无限画布：人物参考/提示词/生成任务/镜头结果节点，保存画布但业务实体只存一份。
- Yjs/Tiptap 同文档 CRDT 协作；镜头间依赖的 DAG 编排。
- 预演片、剪辑工程导出、媒体处理工作流。
- SaaS 运营、插件市场和高级成本统计。

## Codex 任务下发模板
每个任务指定：目标、允许修改的目录、输入契约、输出契约、数据库迁移、测试、完成条件、风险和回滚方式。禁止只凭 UI 截图改动实体模型。任何新第三方 SDK 必须通过审查许可证、维护状态、接口稳定性。

### 现在可直接交给 Codex 的第一张任务单
**任务：M1-01 Database & Auth**
- 读取 `docs/01-PRD.md`、`docs/02-ARCHITECTURE.md`、`docs/03-DATA-API.md`。
- 采用 Drizzle + SQLite 建立 users/workspaces/workspace_members/projects/episodes/shots 表和迁移（已完成基础版）。
- 建立受控的一次性初始化管理员、登录和会话退出；无默认密码；无开放注册。
- 新建 WorkspaceGuard、ProjectGuard 和权限检查 helper；所有资源查询必须做租户隔离。
- 写至少 6 类自动化测试：未登录、普通用户、管理员、跨工作区、越权资源、乐观锁冲突。
- 不接触 ComfyUI、不实现云 Provider、不依赖 NAS。
- 输出迁移脚本、可运行 API、OpenAPI 文档和测试结果；报告任何未完成项。
