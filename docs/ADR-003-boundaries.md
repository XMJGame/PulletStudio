# ADR-003：领域、Provider、Storage 与任务边界

状态：采用。2026-11-04。

模块化单体继续发展。领域类型不依赖 NestJS、Drizzle 或具体供应商。Text/Image/Video/Speech/Audio 独立能力；Connection、ModelProfile、WorkflowProfile、PromptProfile 分离，业务不存节点 ID、IP、宿主路径或特定作品规则。

Text 分析输出 AnalysisRun/Proposal，人工采纳才产生正式镜头。PromptCompiler 输出完整提示词、分段、元数据和警告；旧 PromptArtifact、Take、AssetVersion 固定输入版本。未配置模型也可导入、编辑、手工制作及导出。

任务存数据库，单独 Node Worker 使用 lease/心跳/幂等/错误分类；未确认远端是否接单时进入 NeedsReconciliation，不自动重投。Completed 意味着所需产物归档并关联 Take，远端成功不等于完成。

StorageFacade 后续实现 Local/Mounted 与 S3 adapters；Delivery 单独鉴权，不能将本地绝对路径交给客户端。当前 contracts 是草案，不冒充实现；随首个消费模块完善契约。来源证据读取先隔离在 scripts 服务，后续迁移存储不改变对外身份与哈希。

ProductionUnit、音频轨道和时间线支持通用短片/连续剧/广告/长片；作品与视觉类型只做可选模板/验收资料。画布引用已有实体，不复制业务真相。
