# G1正式引用画布实施合同

2026-11-05。用户提供的G1文本为本轮任务。已核对origin/main=本机19536a8，读取指定基线/实际代码；备份在生成迁移文件前完成：data/backups/studio-2026-11-05T10-09-03-785Z-ddde0414.sqlite。保持NestJS/React/Drizzle/SQLite，不重做G0或队列。

## 复用与兼容

- 授权复用AuthorizationService/ProductionService.access、项目回收站、制作单元范围；镜头使用现有cardRecord（兼容两张不可变卡历史），资产使用EntitiesService/assetApproval，媒体沿用固定MediaVersion与assertSampleAccess/鉴权内容网关。
- 镜头引用为Shot ID＋确切卡version，无完整卡的旧基本镜头须先保存完整卡，不在读取时虚造历史。实体引用为实体ID＋确切revision ID，媒体引用固定version ID。不存在、跨项目或新加无权引用统一拒绝；历史引用因权限/来源缺失变不可用时返回安全占位，不切最新版本。
- 布局不存卡/资产/媒体副本、端点、路径、密钥或Blob。notes/brief仅个人创作文字，不冒充业务数据。连线只注释关系，不修改卡/审批/选片，不运行生成。

## DB与API

- 增量boards/board_revisions，两表项目/工作区/制作单元范围外键。Board只保当前标题/修订计数与创建信息；不可变修订保存标题、schema/layout、作者、时间、UUID请求键/请求哈希。事务先追加修订再CAS更新head，SQL保护历史、范围、连续版本和head一致。无破坏性删表/字段。
- POST/GET /projects/:id/boards（unitId可选、20条游标），GET /boards/:id?revision=N、GET /boards/:id/revisions?before=N、POST /boards/:id/revisions（expectedRevision＋Idempotency-Key）；创建与保存需edit，读取需read。同键原内容响应丢失可重试，变内容/旧版本409；审计同事务。
- GET /projects/:id/board-sources?kind=shots|entities|media&cursor=&q=，本项目有界20条选择器，可按名称/编号搜索。单元画布可引用本项目资源，单元是组织范围，不授予额外权限。业务版本在读取时解析为current/stale/draft/revoked/unavailable，摘要及详情只在当前权限下返回，不持久复制。
- 100节点/200边/布局256KiB；note/brief/reference/group内置注册。UUID节点、受限位置/尺寸/zoom、唯一ID、存在的端点、类型边、分组一级/折叠、无外部媒体URL。G1不做执行DAG。保持已存在且不可访问的固定引用可移动/原样保留，不可借此新增或替换为其他无权引用。

## UI与失败

- 正式入口在项目制作结构，项目/制作单元创建/打开Board；新BoardWorkspace复用React Flow，不依赖lab localStorage。按领域新增canvas/模块与懒加载入口，保留现工作台/生成/审核/交付。
- 真实项目选择器添加正式镜头/四类实体/媒体；便签/说明/分组、拖拽/缩放/框选/小地图、类型线、Inspector、固定版本详情/原件预览。支持分组/折叠、视口/标题恢复、版本状态及明确刷新资源状态；无权资源不展示旧标题/封面。
- 保存显式使用期望修订。409保留本地输入，查看最新/历史不会覆盖草稿；可比较快照、明确重新载入或保留草稿、采用新基线核对后再保存。失响应保留原请求键；项目切换/关闭未保存变更须明确处理，不静默覆盖。不自动上传本地文件作为正式素材，不读G0布局。
- 媒体流复用鉴权网关；文件缺失/编码/撤权时显示无法读取，不静默替换，返回布局不整包读取多GB文件。详情打开时重新授权，页面轮询刷新权限并替换解析结果，生产读权限撤销时清除已解析界面（无法远程擦除已下载内容）。

## 验收

补充API：POST /projects/:id/board-references/resolve，最多100项固定引用，含未保存节点；空请求也授权。前端每15秒/窗口聚焦/手动刷新，详情打开前重新授权，刷新关闭旧详情/比较，避免保留旧隐私摘要。

独立Node集成覆盖DB增量/旧数据/不可变/范围/CAS并发/幂等/审计回滚、引用造假/跨项目/声音权限、旧修订过期/撤销/不可用安全占位、分页/上限/分组/连线、重启/备份恢复/回收站。Playwright使用真实隔离API/媒体，验收项目/单元Board、真实镜头/资产/媒体、刷新/历史/双窗口409保留草稿、详情/播放/缺文件、小屏/键盘与原生产回归。完成后全量必要检查、状态/ADR/证据、Git提交并推送。仅全部门禁通过标G1完成。

G1不做真实生成和多实例调度；ADR-010冻结原生/prompt、多独立实例、auto/manual及Generation边界。后续顺序G2→ComfyUI多实例→团队/批次/交付/部署；手动选机失败不隐式换机，端点只在后端。

## 实际迁移说明

0032_high_gateway建两表；0033_board_guards为生成器创建且被开发服务即时应用的空注释文件，保持原字节，不补写已应用SQL。第二次在线备份为data/backups/studio-2026-11-05T10-11-46-456Z-c31dd90c.sqlite。0034_board_history_protection先完整写SQL、最后登记journal，增加历史/范围/序列/head/布局形状保护。未移动现用数据库/媒体，原46表保留。自动化从0031旧库升级，核对旧表全部行、前32条迁移哈希、新35条及完整性；实际复制恢复证据见阶段history。
