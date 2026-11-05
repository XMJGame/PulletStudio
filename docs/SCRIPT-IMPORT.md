# 剧本导入、锁定与原文定位

打开项目→项目剧本。先保存当前输入，再点击“导入剧本”。选择 UTF-8 的 TXT/MD/Markdown 文件，或切换“粘贴文本”；选择小说、剧本、旁白、广告 Brief，核对标题、全文和顺序，点击“导入为新版本”。原有版本不会删除，不调用外部模型，不自动创建镜头。

单份来源最多 180,000 字节，正文最多 60,000 UTF-16 单元（emoji 通常占两单元）。其他编码请先另存 UTF-8；DOCX/PDF 尚未支持。解析只去除正文开头 BOM，原字节仍完整保留，换行和 Markdown 标记保持原样。编辑区的浏览器显示会把 CRLF 视作换行；原始证据和定位 API 仍保留实际 CRLF。

“查看原文与段落”针对当前已保存版本或正在预览的历史版本，不针对尚未保存的本地草稿。点击段落可在上方选中对应原文，空行也会列出；支持加载更多。导入的版本显示来源类型、字节数及原文件 SHA256，可点击“下载导入原文”。手动编辑/恢复创建的新版本没有独立来源文件，可到原导入版本下载。每个历史版本的正文仍独立保存。

项目管理及工作区管理身份可“锁定当前版本”；锁定不增加文本版本。所有保存、导入、历史恢复都被后端阻止，必须明确点击“解锁以继续修订”，才能创建新修订。解锁不修改旧历史，不代表完成后续正式审核流程。编辑成员不能解锁，只读成员不能导入或修改。

多人同时操作发生 409 时，导入对话框保留预览，点击“刷新版本后重试”读取新基线，再次确认才新增版本；不会自动覆盖。若他人已锁定，需关闭后请管理员处理。保存遇到锁定或冲突时，本地输入仍保留，可以先复制后载入最新剧本。

## API 与存储说明

沿用 `/api/v1/projects/:projectId/script`：

- `POST /import`：`{expectedVersion,title,kind,source}`，source 为 `{type:"file",fileName,base64}` 或 `{type:"paste",text}`。编辑权限，锁定返回 423，版本冲突返回 409。
- `POST /lock`、`POST /unlock`：`{expectedVersion,expectedLockVersion}`，项目管理权限；两项版本都校验，避免旧页面意外改变定稿状态。
- `GET /versions/:version/source`：鉴权下载原始字节；无独立来源返回 404，不透露宿主路径。
- `GET /versions/:version/spans?after=0&limit=100`：返回 revisionId、checksum、offsetUnit=utf16、items 和 nextCursor。startOffset 包含，endOffset 不包含，textHash 为该切片 UTF-8 SHA256。游标必须在完整段落边界；每页最多 100。源行保留分隔符，拼接全部 items 等于该版本正文。

这是定位证据的派生 API，尚未实现正式镜头引用表/跨版本重定位；每个标识由 revision ID、offset 与 text hash 决定，修订后不会假装原定位自动迁移。当前有界文本原件在不可变 `script_sources` BLOB 中保存，随 SQLite 在线备份一同备份；未来媒体 StorageFacade 不以这个表作大文件上传库。

## 迁移与回退

`0006_smooth_sentinels` 增加来源表、scripts.lock_version/locked_at/locked_by；`0007_immutable_script_sources` 为原始来源加禁止修改/删除触发器。旧数据默认未锁定，原 script_revisions 不改写，历史保护触发器继续有效。

本机迁移前在线备份为 `data/backups/studio-2026-11-04T11-43-55-417Z-9104f96c.sqlite`。恢复流程沿用 `05-DEVELOPMENT.md`：停止 API，复制备份到新本地路径、修改 DATABASE_PATH、重启验证，保留原库。回退后本阶段新录入内容不在旧快照内，须先保留当前库与备份，不能直接覆盖。
