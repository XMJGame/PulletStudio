# 分镜文档导出：Markdown / JSON / CSV

2026-11-05，Phase B3 基础范围已实现。沿用现有 API/Web，不需要模型、API Key、文本 Worker 或媒体 Storage。导出记录固定保存在 SQLite，下载后可供外部制作工具使用，不是媒体包或可重导入项目。

## 操作

项目→“制作结构”→“导出分镜文档”。选择格式、范围和提示词来源，点击“预览分镜导出”核对镜头数量、缺卡/缺词及旧提示词警告，再点击“生成分镜文件”。成功后下载文件，SHA256 用于核对完整性。关闭后重新打开，可从历史再次下载同一字节文件。

- 范围：全部项目、仅直属镜头、指定制作单元（可选含下级），或仅当前选中镜头。API还支持显式镜头ID集合。单元路径和镜头编号一起展示；不同单元的 SH001 不混淆，后台内部根行不对外导出。
- 已保存提示词：各镜头最近的已保存Artifact。当前卡已修改时仍导出原词、原输入卡版本和变化警告，不擅自重新编译。没有已保存词时明确留空。
- 本次中立编译：对已有完整卡离线编译当前项目设定，不另存Artifact，不采用自定义Profile规则。未保存完整卡的镜头只输出已有基本资料和缺失警告，不制造卡、来源或模型成功状态。
- 预览后内容变化会拒绝旧预览，选项保留，点击“重新预览分镜导出”再确认。请求响应丢失时直接重试“生成”会复用原请求；改选项或重新预览会准备新的导出请求。

拥有项目查看权限即可导出可读内容，包括 Viewer；创建请求仍需登录/CSRF。历史文件继续受当前项目授权约束，成员被移出或项目移入回收站后，原下载链接也不能读取。文件包含创作正文、原文片段及制作规则，应按项目资料保管。

## 格式与固定内容

JSON 的 `schemaVersion=studio.storyboard.v1`，包含 exportId、exportedAt、snapshotHash、固定项目设定、所选制作层级、当前镜头/完整卡、原文修订/字符偏移/文本/SHA256、已保存词或中立编译的完整输入输出、警告。未配置的媒体/实体引用如实为空，不包含会话、密码、Provider Key 或宿主路径。

Markdown提供可读的完整卡、引用原文、正/负提示词与元数据代码段，保留单位层级。标题经过转义，创作文本不会被当作HTML执行；围栏长度根据文本中的反引号调整。

CSV采用 UTF-8 BOM 和 CRLF 行分隔，正确转义引号、逗号和单元格内换行，含画面/镜头/动作/声音/时长/完整词及 `card_json` / `sources_json` / `prompt_json` 等列。防公式处理会为危险起始内容加单引号：包括空白/控制字符后 `= + - @` 及起始TAB/换行。需要逐字原值和完整结构时用JSON。

`snapshotHash` 由所选格式和固定快照（不含生成ID/时间）计算，用于预览冲突校验；下载文件SHA256是最终UTF-8字节的哈希，两个值用途不同。文件保留生成时的警告，此后项目变化不会重写旧文件。重新反映新内容请生成新导出。

## API

前缀 `/api/v1`，OpenAPI 为字段校验事实源。

| 接口 | 用途 |
|---|---|
| POST /projects/:id/storyboard-exports/preview | format=json/md/csv、promptMode=saved/neutral、scope；返回预览摘要、snapshotHash、大小和警告，不写库 |
| POST /projects/:id/storyboard-exports | 相同选项 + expectedSnapshotHash；必须带UUID Idempotency-Key，保存固定文件和审计 |
| GET /projects/:id/storyboard-exports?cursor=UUID | 元数据历史20/页，按创建时间/ID倒序，不返回文件BLOB |
| GET /storyboard-exports/:id | 记录元数据、范围、冻结的项目设定与总警告 |
| GET /storyboard-exports/:id/file | 当前授权校验后返回固定附件；Content-Type/Length/Disposition、X-Content-SHA256，no-store |

scope 可为 `{type:"project"}`、`{type:"root"}`、`{type:"unit",unitId,includeDescendants:false}` 或 `{type:"shots",shotIds:[...]}`。ID均由系统产生，外来项目/重复镜头/内部根单元/无效范围拒绝。无镜头返回400；预览变化/同键异参返回409；超限413且不截断；撤权/回收站404，未登录401。

## 大小、数据和恢复

本版为有界同步文本处理：单次200镜头、项目最多2000制作单元、紧凑快照4MiB、最终文件8MiB。相同资料在CSV不同列中会重复，因此JSON可导出而CSV过大时仍会拒绝。请按单元或镜头拆分；长片流式/异步全量导出、媒体ZIP、项目重导入另行验收。

0016 只增 storyboard_exports、复合外键/索引/大小约束，0017 保护UPDATE/DELETE；原表/SQL/编号不重建。快照JSON、文件BLOB、SHA256/大小及审计在同一事务写入，失败不会留下半份文件记录。存储只支持保留/读取，没有物理删除/过期清理UI；后续Storage迁移须校验字节并保留ID。

迁移前在线备份：`data/backups/studio-2026-11-05T03-41-26-732Z-83175a29.sqlite`。独立副本恢复及正式库数量核对见 IMPLEMENTATION-STATUS；隔离测试也验证了含导出文件BLOB的备份恢复。回退先停服务、保留当前库，把旧备份复制到新本地路径，并使用匹配旧代码；不能覆盖运行库、逆向删除新记录。旧备份不包含之后新导出，备份本身含创作内容且应私密保管。
