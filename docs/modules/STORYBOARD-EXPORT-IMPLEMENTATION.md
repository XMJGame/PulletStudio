# Phase B3：离线分镜文本导出实施合同

2026-11-05，编码前记录。复用完整卡、PromptArtifact、制作层级、授权/CSRF/审计与 Dialog，不调用模型、不改正式内容。本包是有界文本交付，不是媒体包/项目迁移或异步视频 ExportJob。

- 修改 API `exports/` 新模块、app.module、db/schema 与增量迁移；Web 新增 StoryboardExportDialog，接入 StructureWorkbench，不重写已有页面。复用 production/card 统一历史读取、PromptService 的固定快照/变化判断，不重新编译已保存提示词。
- Scope：全部项目、仅项目直属、指定单元（可选含后代）、显式镜头 ID 集合。单元和镜头先验证同项目/工作区，不暴露 project_root ID；单元按树/排序/ID稳定排列，镜头按所属单元和 sequence/ID 排序，显示完整单元路径避免重复 SH 编号混淆。客户端不传原文、卡内容或文件路径。
- Prompt 模式：saved 导出每镜最新已保存 Artifact（即使过期也保留完整快照并明确警告，不能冒充当前卡提示词）；neutral 仅对已有完整卡调用内置离线 preview，标明临时编译非已保存 Artifact。没有完整卡/提示词如实标记缺失并包含已有基本镜头资料，不补写卡、不造引用。
- POST `/projects/:id/storyboard-exports/preview` 接 format=json/md/csv、scope、promptMode，返回数量、版本摘要、缺失/过期警告、内容哈希及边界；不写数据库。POST 同路径（无 /preview）接相同选项 + expectedSnapshotHash，要求 UUID Idempotency-Key。预览后任一卡/单元/项目/所选提示词/Profile/原文变化导致哈希变化时409，输入保留并须重新预览；同键同请求重放返回既有导出，即使之后项目内容已改动，同键异参409。
- 新增不可变 storyboard_exports（scope、请求/快照hash、快照JSON、格式、UTF-8文件BLOB、SHA256/大小、作者/时间），unique(project,actor,key)，复合外键和列表索引；不重建旧表。一次短事务冻结输入、文件和审计。小型文本上限200镜头、项目层级最多2000单元、快照4MiB、文件8MiB；超限明确拒绝，不截断，不把长片整稿无限载入内存。更大范围须按单元/镜头拆分，流式/异步全项目包后续。
- GET `/projects/:id/storyboard-exports` 分页历史；GET `/storyboard-exports/:id` 元数据；GET `.../:id/file` 带授权返回固定字节、Content-Type、Content-Disposition 和校验信息。所有接口要求项目查看权限（Viewer可导出自己可读内容），POST同样需CSRF；撤权、回收站后文件不能通过旧链接读取。UUID只作身份，不是授权。文件名仅后端编号/UUID生成，不用用户标题拼宿主路径。
- JSON 包含schemaVersion、固定项目/单元/镜头/卡/原文证据/提示词全输入和输出、警告；不含凭据、会话、用户密码、宿主路径。MD用安全标题与原文/完整词代码段，不让素材文字变成可执行HTML。CSV完整转义引号/换行/逗号，UTF-8 BOM，所有单元格做首部空白/控制字符后 = + - @ 检测并加单引号，保留原值可用JSON格式。CSV包含卡/原文/提示词JSON列保证长文本不丢。
- UI：明确范围/单元后代/所选镜头、格式和Prompt模式，先预览警告与数量再生成，成功显示鉴权下载链接/SHA256；历史可再次下载。网络失败同键重试，改选项清预览，409不覆盖选项。手机正文滚动/按钮可见、键盘/Esc；历史分页。
- 验证：无模型手工项目三格式、AI来源/旧词警告、全部范围/空范围/外来ID、角色/CSRF/撤权/回收站、预览零写入、旧预览409、重放/并发/回滚、不可变/重启/备份恢复；UTF-8/CRLF/emoji/引号/CSV注入；200上限/字节限制不截断；浏览器真实下载内容和哈希、手机与预览冲突。迁移前在线备份，实库数量比对及独立恢复，不用真实内容造样例。
- 回退：停服务、保留当前库，把迁移前备份复制到新路径并使用匹配旧代码。新快照不在旧备份内，不能覆盖运行库/删除新增业务记录。备份含导出正文，按原数据库同等私密保管。
