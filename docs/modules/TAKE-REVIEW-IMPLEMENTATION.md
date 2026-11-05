# Take 提审、审批与选片实施合同

复用现有不可变 Take、媒体原件、独立 review 权限、完整卡和生成任务。原 takes.state 保留 draft 的入库语义，通过新增 review 状态描述实际审核进度，兼容旧调用者。

- 数据库增量追加 take_review_events 与 shot_take_selections。各自有连续版本、操作者、理由、时间、UUID 幂等键和不可变保护。范围外键关联确切 Take/镜头/项目/工作区/媒体；Take 增加复合唯一索引，不重建已有表。选片固定具体批准事件。
- 提审需 edit 权限和已保存完整卡，冻结当前 shotVersion/projectVersion、固定媒体，以及可用的 generationJobId/promptId 和生成时版本。手工媒体来源明确为空。待审核可以撤回；草稿、已拒绝、已撤销可以重新提审。审核者可批准或拒绝待审核候选，批准后只有审核者可以撤销。批准前核对提审时上下文版本，变化后先撤回再提审。审核和审计同一事务。
- GET/POST /takes/:id/reviews 读取20条分页历史或追加动作，POST 包含 action、reason、expectedDecisionVersion 及 Idempotency-Key。动作包括 submit/withdraw/approve/reject/revoke。并发只接受一个有效决定，重试返回原事件，改变请求返回冲突。授权在重试时重新核对。
- GET/POST /shots/:id/take-selection 读取选片及有效性或选用/清除。写入需 review、expectedSelectionVersion、takeId（清除为null）、reason 和 UUID 幂等键。只选同镜头已批准且上下文有效的候选。撤销批准、制作卡或项目变化后旧选片标为失效，后续重新批准需明确重新选用。新生成和新增候选不改选片。
- takeList 增加 review 摘要，保留原字段及分页。读取和写入沿用项目/工作区/回收站授权。操作同时核对受保护声音样本的读取权限。候选状态与镜头原有制作状态独立。
- 前端在现有媒体 Dialog 中为候选提供审核入口，复用媒体预览和 Dialog。新增 TakeReviewPanel 展示状态、冻结版本、分页历史、动作理由和明确刷新入口；冲突及网络失败保留理由，同键重试。选片状态和审核状态分别展示，审核者可选用或清除。
- 隔离数据库测试权限、跨项目、状态机、CAS/幂等、快照/旧任务、同事务回滚、不可变/范围约束、撤销/版本变化使选片失效、分页、重启及在线备份恢复。Edge 测试提审、批准、选片、撤销、失败保留输入、手机/桌面及键盘。正式库迁移前在线备份，迁移后核对旧表数量与独立恢复副本。

本包交付 E 的审核和选片基础。分工、评论、批次、通知及素材包后续逐项实施。
