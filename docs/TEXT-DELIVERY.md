# 完整制作卡与离线提示词

2026-11-05；已交付 Phase B1/B2 的基础链路。使用现有 API/Web，无 API Key、文本 Worker 或媒体模型也可运行。MD/JSON/CSV 分镜导出为下一工作包。

## 使用

项目→制作结构（或旧分集故事板）→选择镜头→“编辑完整制作卡”。可先手动添加普通镜头，再补完整卡，不需要 AI。填写标题、意图、画面、景别/视角/构图/运镜/动作、光线/情绪、对白/声音、整数秒计划时长、制作方式、资产名称与风险。原声可计划保留/静音/先检查/替换，保存不会改媒体。已有来源固定保留；无来源为真实手动创作，不生成伪引用。

保存新增 Shot 版本和完整卡快照。旧基本编辑器仍可使用，会保留其他完整字段并新增历史。完整卡历史与原始 AI 卡共用读取入口；历史查看不会恢复或覆盖当前版本。双人保存冲突时保留表单，只有“载入最新制作卡”才替换输入。

点击“镜头提示词”，默认“中立手工交付”。项目管理者可新建 Profile 或追加修订，配置前后置说明、正向规则、禁止项及单独负面/正向避开表达。Profile 是版本化创作规则，不是已验证模型 capability；不执行模板、代码或网络请求。

“预览完整提示词”只读编译，“复制完整提示词”复制正向和负面文本，“保存提示词快照”明确持久化当前固定输入；保存需要项目编辑权限。预览允许 Viewer，Profile 写入需要项目管理权限，Reviewer 角色本身不授予编辑权限。全部后端校验，不依赖按钮隐藏。

修改镜头、项目设定或 Profile 后，旧快照仍可打开；会标出输入变化并提示重新编译。原文变化也会警告，引用仍是原卡固定版本。刷新编译基线后重新预览/保存，不会覆盖历史记录。保存历史按创建时间倒序分页，同毫秒以 ID 排序；列表每页30。

## 输出与真实边界

- 输出完整 positivePrompt/negativePrompt、结构段落、音频计划、warnings、compilerVersion。完整画面词包含已填写镜头/风格/导演/动作/声音/规则，空字段不伪造。
- Artifact.snapshot 固定卡 ID/版本/全字段/原文证据、项目设定版本、Profile 修订及编译器版本；记录操作者/时间。freshness 是当前读取时计算，原 snapshot/rendered 不变。
- 暂无媒体 ModelProfile/实体版本绑定，inputBindings/entityRevisions 为空，productionReady=false。assets 只是待落实名称，不能当成已批准参考图。中立词不保证特定服务效果，不自动翻译或付费调用模型。
- Director/Style 当前使用项目既有设定快照，独立可复用版本库、模型方言/图像和视频词专用模板后续实现。计划时长不是配音/成片测量；原声策略不操作文件。
- 来源本包固定且不可伪造，不提供手动选择新原文、跨版本重定位；AI 采纳时验证的来源保留。完整 V1 的存储/生成/Take/时间线尚未交付。

## API（统一 /api/v1）

| 接口 | 输入/行为 |
|---|---|
| GET /shots/:id/card/editor | 服务端表单基线、已有卡、Shot/Project 和权限；不写库 |
| PATCH /shots/:id/card | expectedVersion、完整 body、summary 可选；body.sourceSpanIds 必须等于服务器固定引用，sourceAudioPolicy=keep/mute/inspect/replace |
| GET /shots/:id/card 及 /versions | 复用原完整卡接口，合成一条版本历史 |
| GET /projects/:id/prompt-profiles?cursor=UUID | 每个 Profile 最新修订，每页30；nextCursor 是稳定 profileId |
| POST /projects/:id/prompt-profiles | name、config（prefix/suffix/positiveRules/negativeRules/negativeMode），后端生成 ID |
| POST /prompt-profiles/:revisionId/revisions | name/config + expectedVersion；追加相同 Profile 的新修订 |
| POST /shots/:id/prompts/compile | mode=preview/commit、expectedShotVersion、expectedProjectVersion、profileRevisionId 可空；默认内置中立 |
| GET /shots/:id/prompts?cursor=UUID | 提示词历史元数据，30/页 |
| GET /shots/:id/prompts/:artifactId | 固定输入/完整输出/当前变化提示 |

OpenAPI 为字段校验事实源，Cookie/CSRF/回收站/成员撤权规则不变。卡保存和 commit 使用事务；预览不创建历史。Profile/Artifact/卡历史不可变。

## 数据与回退

旧 shot_card_revisions 强制关联 AI Proposal，保留原表不重建；0014 新增人工 shot_card_editions、prompt_profiles、prompt_artifacts，0015 约束两套物理卡的版本不能重复、来源/产物不能跨 scope、历史不能 UPDATE/DELETE。共享卡服务以 Shot.version 组织单一逻辑历史，不复制旧卡，AI 初次采纳仍写原表。原因和成本见 ADR-005。

实库迁移前在线备份 `data/backups/studio-2026-11-05T03-07-14-233Z-8eb4ecc4.sqlite`；独立副本恢复与升级核对见 IMPLEMENTATION-STATUS。回退先停服务，保留当前库，复制备份到新的本地路径并使用匹配旧代码。旧备份不含之后的新卡/提示词，不覆盖运行中的 DB，也不反向删除新记录；原 Provider 加密密钥另外保管。
