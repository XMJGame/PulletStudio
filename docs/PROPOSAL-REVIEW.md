# 分镜草案审核与镜头制作卡

P2-B1 已实现“模型草案→人工修订/审核→正式镜头及来源版本”。无需额外启动服务，沿用 API、Web 与文本 Worker。自动化使用隔离 Mock；真实模型尚未联调，媒体生成与 Take 审核尚未实现。

## 操作流程

1. 项目→AI 分镜，选择已完成分析任务。候选包含意图、画面、景别、视角、构图、运镜、动作、光线、情绪、对白/声音说明、计划时长、建议制作方式、候选资产、风险和原文引用。
2. 编辑者点击“编辑候选”，修改内容、选择本次分析范围内的引用并保存。每次保存追加草案版本，模型原始结果始终为只读 v0。当前候选数量和顺序固定，不能在同一草案内增删/重排。
3. 审核者可填写理由拒绝；被拒绝草案不可编辑或采纳，可填写理由重开。所有决定与历史保留。编辑和审核是独立权限。
4. 每个候选确认 1–3600 的整数秒计划时长后，审核者点击“采纳为正式镜头”，选择项目直属镜头或已有制作单元，并明确确认创建全部候选。模型给出的数值也需此次人工核对；系统不补默认 5 秒。该计划不代表测量过的配音或成片时长，精确声音时间线后续实现。
5. 若分析后原文或项目设定已有新版本，须核对差异并额外确认按原来源采纳。不会改写原文，也不会将旧字符偏移自动套到新文本上。
6. 采纳成功后显示正式镜头编号，可查看完整制作卡、引用原文及版本历史。已采纳草案固定，后续正式镜头基本编辑或“编辑完整制作卡”会追加卡版本，其他字段和固定来源保留。完整卡与离线提示词的新增用法见 [TEXT-DELIVERY.md](TEXT-DELIVERY.md)。

双窗口操作使用版本条件。冲突时保留本地候选输入，用户明确“载入最新草案”后才替换表单；审核冲突可刷新审核信息并重新确认。查看历史只作预览，不替换当前内容。旧手动镜头未有完整卡时显示相应说明，不虚构来源或历史。

## 权限与状态

| 操作 | 权限 |
|---|---|
| 查看草案、历史、制作卡和原文 | 项目查看权限 |
| 编辑待审核候选 | 项目编辑权限（EDITOR、项目管理、工作区管理员） |
| 拒绝、重开、采纳 | 项目审核权限（REVIEWER、项目管理、工作区管理员） |
| 编辑正式镜头基本字段 | 项目编辑权限；REVIEWER 角色本身不授予该权限 |

待审核 draft → 拒绝 rejected → 重开 draft；待审核 draft → 采纳 accepted。accepted 为固定审核快照，不支持撤销、重新采纳或改投其他单元；需要后续修改时追加正式镜头版本。工作区/项目撤权即时生效；回收站内草案和制作卡不可读写。这是 Proposal 人工门禁，不等于未来 Take 的 Submitted/InReview/Approved 审批流程。

## 数据一致性

- 原 analysis_proposals 不改；proposal_reviews 为当前状态指针，proposal_revisions 追加完整候选快照和决定。首次读取 v0 不产生审核记录。
- 一次 immediate 事务保存审核版本、正式 Shot、后台编号计数、shot_card_revisions、script_spans、shot_script_spans、proposal_adoptions 和审计。任一步失败全部回滚。
- 同一 proposal/candidate 唯一关联一个正式 Shot；相同版本、目标与项目版本的采纳重放返回既有映射，版本冲突或改投目标拒绝。并发请求不会产生第二组镜头。
- 来源以不可变 script revision ID、UTF-16 半开区间和 SHA256 保存，采纳前核对原文哈希；外键同时限定项目和工作区。历史卡保留采纳修订和模型配置来源。
- 草案修订、制作卡、来源和关联通过不可变触发器保护。正式镜头版本与已存在制作卡版本同步增长；原有手动镜头继续沿用旧数据。

## API

统一前缀 `/api/v1`，沿用会话、CSRF 与项目授权；字段定义见本机 OpenAPI。

| 路径 | 用途 |
|---|---|
| GET /proposals/:id | 当前审核版本、候选、权限、输入变化及正式镜头映射 |
| GET /proposals/:id/versions?before=N | 历史每页 30，最终包含原始 v0 |
| GET /proposals/:id/versions/:version | 指定只读快照，允许 v0 |
| PATCH /proposals/:id/shots/:index | 零起始候选索引；expectedVersion、完整 shot、summary 可选 |
| POST /proposals/:id/reject 或 /reopen | expectedVersion、必填 reason |
| POST /proposals/:id/accept | expectedVersion、expectedProjectVersion、unitId（空为直属）、acknowledgeCreation=true、变化时 acknowledgeInputChanges=true |
| GET /shots/:id/card | 当前完整卡；无卡 available=false |
| GET /shots/:id/card/versions?before=N | 正式卡历史每页 30 |
| GET /shots/:id/card/versions/:version | 指定卡版本，版本从 1 开始 |

GET /analysis-runs/:id 内的 proposal 同步返回最新人工审核版本；分析任务 completed 与草案 accepted 含义不同，不能以任务完成代表正式镜头已经创建。

## 迁移、验证和边界

0012_light_selene 仅追加六张表和范围索引，0013_review_history_guards 追加历史不可变及采纳关联保护触发器，未重建旧表。迁移前备份为 `data/backups/studio-2026-11-04T14-17-20-763Z-c36d17e7.sqlite`。本机共 24 张业务表、14 次迁移，原账户/工作区/项目/分集/镜头/正文/来源/模型/分析记录数量与备份一致；integrity=ok、foreign_key_check=[]。实际库没有写入测试草案、镜头或连接。

回退按 `05-DEVELOPMENT.md` 停服务、保留当前库、将备份复制到新的本地数据库路径，再修改 DATABASE_PATH；不覆盖运行中的库，不删除新业务记录。备份发生在本阶段之前，因此不含之后采纳和修改的数据；回退需要同时使用匹配的代码版本，并单独保留原 Provider 加密密钥。

验收：70 项 Node 接口/服务测试（含容器）通过，覆盖角色、来源、乐观锁、整份审核、旧来源确认、并发/重放、注入中途失败后的全事务回滚、正式卡续写、撤权/回收站和重启。Edge 全流程通过，包含双窗口冲突、手机候选编辑/采纳、历史原文及正式卡版本；类型、构建和格式检查通过。

后续 Phase B1/B2 已增量交付完整手动制作卡编辑与离线提示词编译；本文保留 P2-B1 审核的阶段记录。Story Bible、层级分析、候选增删/重排、文本导出、素材/Take 审核、精确声音时长与预演尚未完成。P2-B 整体仍为部分完成，本阶段不会调用 ComfyUI。
