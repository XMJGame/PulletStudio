# Phase B1/B2：完整卡与离线提示词实施合同

2026-11-05，编码前记录。对应旧 P2-C 第一工作包；Phase B3 文档导出为下一包，不声称本次完成全部文本交付。

- 复用 production/shot-cards、Shot/version、授权、审计、analysis-contract 的字段、Dialog/ShotEditor/ShotCardDialog。AI 模型 schema/原草案保持不变，完整人工卡可无来源；已有来源按服务端已验证的证据 ID 保留，不接收客户端原文/偏移伪造。
- Schema 只追加 shot_card_editions、prompt_profiles（每行一个不可变修订，稳定 profileId + version）、prompt_artifacts；旧表/SQL/审核内容不重建。新人工卡 sourceProposalRevisionId 可空，统一卡读取按 Shot.version，跨表重复版本和所有历史修改由触发器阻止。完整卡以来源 ID 数组引用已存在且同项目的 ScriptSpan；本包保留原来源不提供来源迁移/伪造入口。
- API：PATCH /shots/:id/card，expectedVersion + 完整 body + summary；GET /shots/:id/card/editor 提供服务端基线（旧镜头只初始化表单不写库）；GET/POST /projects/:id/prompt-profiles、POST /prompt-profiles/:id/revisions（expectedVersion）；POST /shots/:id/prompts/compile，mode preview/commit + expectedShotVersion/expectedProjectVersion + profileRevisionId 可空；GET /shots/:id/prompts（分页）、GET /shots/:id/prompts/:artifactId。
- 卡编辑用 edit，profile 管理用 manage，compile preview 用 read、commit 用 edit，历史用 read。401/403/404/409/回收站均沿用既有授权；expectedVersion 防冲突，preview 不写库、commit 事务冻结完整输出和输入。普通 Viewer 不可写入卡/Profile/Artifact；Reviewer 不因审核角色获得编辑权限。
- 前端：完整卡表单与基本编辑并存，首次手动镜头可补齐；所有字段、计划时长、原声处理计划可编辑；无来源如实显示。提示词对话框支持选择 Profile/追加修订、预览/复制/明确保存/历史/过期提示。失败保留输入，409 明确刷新基线。保存卡后父视图重新加载以更新版本。
- 编译：纯确定性，无网络/模型/模板执行，拼接完整画面、意图、风格/导演、镜头/动作、音频与约束。Profile 包含可选前后缀/正向规则/负向规则及负面词支持，默认中立内置版本。负面词不支持时提示警告并在正向用避开说明，不静默丢失。原始音轨 keep/mute/inspect/replace 仅为制作计划，默认 inspect，不实际改媒体。
- Artifact 快照冻结卡 ID/版本/来源、项目设置、Profile 修订、编译器版本、操作者/时间。当前 freshness 比较卡/项目/Profile 头；历史不覆盖，不假造引用图、资产版本、媒体 ModelProfile 或成本。无实际引用/模型能力时显示手动交付与未验证警告。
- 测试：旧 AI 卡/人工卡统一历史和基本接口续写、全字段/无来源/保留来源/不可变、跨项目/只读/回收站/重启、并发409；preview无写入、确定输出、风格/规则/声音不丢、Profile CAS、Artifact不可变/过期/分页；浏览器双窗口/手机/复制/历史。基线70测试/E2E重新执行，迁移前在线备份，独立恢复副本核对旧数据，新增表失败事务回滚。
- 回退：保留原库，在新路径恢复本次迁移前备份并使用匹配旧代码；不可覆盖运行库。新卡和 Artifact 不存在于旧备份，先保留现库，不逆向删新记录。
