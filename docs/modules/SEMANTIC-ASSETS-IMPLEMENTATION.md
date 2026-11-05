# Phase C3/C4：语义资产与镜头固定引用

2026-11-05，编码前合同。复用 Local 媒体/版本、Shot/Card历史、RBAC/CSRF/审计、PromptCompiler及Dialog，不变更框架、不重建旧表、不复制文件。

- 新增 asset_entities（稳定项目/工作区身份与当前版本）、asset_entity_revisions（追加名称/描述/类型属性/幂等证据）、entity_media_bindings（具体修订的语义位置→固定媒体版本）、shot_asset_bindings（具体卡版本→固定实体修订/用途）。所有ID服务端生成；实体kind固定，修订及绑定不可变，FK保证同项目范围。当前仅项目内复用；跨项目授权共享后续独立实现。
- character、environment、prop、voice 分类型Zod：人物外观/服装/状态；场景布局/光线/状态；道具形体/尺度/材质/状态；声音语言/音色/使用权/同意状态。均为草稿，不冒称正式批准。每修订最多10个媒体参考，位置含front/side/back/closeup/overview/floorplan/detail/reference/voice_sample；角色参考和场景视图为独立文件，不强制拼图。声音样本必须音频，其他位置必须图片；不上传任何外部服务。
- 声音样本读取收紧到上传者、项目管理者或审核者；引用过声音样本的固定版本持续受保护，移除当前引用不能解除历史限制。媒体播放/下载/封面和Take读取的文件入口统一执行该检查；同项目普通读者可读资产文字设定与样本元数据，不因此获得样本文件。选择样本前再次检查访问权。UI说明这一规则，授权/同意未知时明确警告，不启用生成。
- API：GET/POST /projects/:id/entities（kind、20条分页、创建UUID幂等键）；GET /entities/:id；GET/POST /entities/:id/revisions（expectedVersion、UUID幂等键、正文及媒体引用整体追加）；GET /entities/:id/revisions/:version；GET /entities/:id/impacted-shots（当前/历史卡引用可辨）。所有写要edit，所有读要read，回收站/撤权即时拒绝。创建/修订/审计同事务，版本CAS，失响应同键重放不重复。
- GET/POST /shots/:id/asset-bindings：当前完整卡最多20个实体引用，revisionId+purpose。保存要expectedShotCardVersion，追加正式卡/Shot版本与绑定，不改原文/旧卡。旧完整卡保存请求未传新字段时保留已有绑定，明确空数组才清空；旧基本字段编辑继续保留。无完整卡先提示创建，不虚构卡。正式资产审批/连续性约束/LookVariant/跨资产Voice关系后续实现。
- production/formal-card、shot-cards、card-authoring；新增 assets/entity-contract、references、service/controller；prompt/compiler/service收集固定实体/媒体输入快照，文字可复制、inputBindings明确ID/角色。实体或参考媒体有新版本仅提示stale，旧Artifact不改；新编译继续使用卡里固定版本，必须明确更新镜头引用。仍productionReady=false（无批准与模型能力）。分镜导出复用卡/Prompt快照，不另造来源。
- Web：项目“资产库”类型切换/草稿创建/编辑/历史/影响镜头/固定媒体位置；镜头“资产引用”选择具体修订/用途，保存追加卡；卡详情展示引用，完整卡编辑保留绑定。失败保留输入，409明确载入新基线；桌面/390px/键盘验收；不显示SHA256或要求手填ID。
- 验证：隔离DB/媒体根，四类校验、真媒体引用/类型、跨项目/角色/CSRF/声音样本/撤权/回收站、并发CAS/幂等/SQL回滚、不可变/历史/影响/分页、卡旧接口兼容、Prompt固定快照/旧实体与媒体stale、导出/重启/备份恢复；实际浏览器创建/媒体选择/卡引用/提示词/历史/手机/冲突。
- 只增迁移，实库迁移前在线备份；原33表记录数量保留，新增表不填正式样例。数据库与媒体仍按LOCAL-MEDIA完整备份。真实Provider/ComfyUI、资产正式审批、批量自动生成、跨项目共享与长片吞吐不在本包宣称范围。
