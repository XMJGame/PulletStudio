# 已选素材包

项目制作结构中的“导出素材包”可以交付已批准、已选用的镜头原件。范围可选当前镜头、项目直属镜头、制作单元（可包含下级）或整个项目。每包最多100镜头，原件去重后合计2GiB，清单最多4MiB。

1. 在“镜头素材”完成提审、批准和选片。
2. 打开“导出素材包”，选择范围并预检。预检列出各镜头及待处理原因，范围内全部有效后可以确认。
3. 确认范围及原件交付，保存清单。系统检查原件并再次核对选片和权限，保存固定快照。
4. 点击“下载素材包 ZIP”。原件逐个校验后按字节写入ZIP。清单中的相对路径、字节数和SHA256用于逐文件核对。历史包可以在同一窗口下载。

## 文件与来源

新页面默认创建标准后期交付包：`manifest.json`、按实际媒体类型出现的 `01_Video/`、`02_Audio/`、`03_Images/`，以及 `05_Documents/ShotList.csv` 和 `ProductionNotes.md`。媒体名例如 `SH001_Take03.mp4`，由平台安全分配，碰撞自动追加后缀；用户不填写路径。同一原件被多个镜头选用时只写入一次，CSV每个镜头都引用实际路径。音频暂不按旁白/对白/音乐/音效猜测分类。

CSV带UTF-8 BOM，区分制作卡计划秒数与原件实测毫秒，记录本次顺序、层级、镜头/卡/Take/媒体/审批版本、相对路径、帧率/尺寸、原声意图、描述/对白/声音说明和固定资产修订引用。单元格按CSV转义并防公式注入。制作说明解释共享原件、时长与审核边界及未包含的参考原件/附件。原件不被转码或按静音计划改写。

历史v1仍包含 `manifest.json` 和 `media/<媒体版本ID>.<扩展名>`，下载字节不变。新标准格式是v2，文档的UTF-8正文、路径、大小及哈希一起冻结在manifest.documents，ZIP里对应文档与冻结正文一致。两份文档合计最多2MiB，整体快照仍最多4MiB，超限明确失败不截断。

v1/v2共同记录项目设定、制作层级、镜头顺序、完整制作卡、确切Take、选片事件和批准依据、原件路径/大小/校验码/探测元数据。生成候选另保留生成任务、工作流身份与定义哈希、固定参数、确切提示词快照。手工关联媒体的生成来源为空。制作卡中参考素材保留版本引用，包内文件以本次选片原件为范围。

交付清单是历史快照。之后换片、改卡或撤销批准时，已有清单仍表达创建时的决定。历史下载需要当前项目和包内原件的读取权限。受保护声音样本权限变化后，历史包同样受限。文件缺失、损坏或存储根不匹配时下载会失败。下载期间发生读取或完整性异常会中断ZIP流。

数据库保存清单和创建记录，ZIP在下载时流式组装。接口状态 `snapshot_ready` 表示固定清单已保存。恢复这些历史包需要配套的SQLite及完整媒体根，按 LOCAL-MEDIA 的备份流程执行。

本包适用于素材交付，不是编辑器工程或完整项目备份。当前没有同时附加独立旁白/BGM/SFX和SRT的入口，不从对白推断时间码，不生成占位SRT/PDF或空目录。后续声音/字幕附件须有角色、固定版本、审批与时间码来源；完整项目重新导入、参考原件全量打包和大包异步任务另做。OTIO/FCPXML需要逐软件/版本验证，不阻塞V1。产品边界见ADR-009。

## 接口

均在 `/api/v1` 下，沿用登录、项目读取权限及写操作CSRF保护。

- `POST /projects/:id/media-packages/preview`，正文为 `{scope, layout?: "delivery"}`。省略layout兼容v1，delivery创建v2。scope复用分镜导出的project/root/unit/shots合同，返回ready、snapshotHash、镜头状态、原件大小、实际媒体目录及文档路径。
- `POST /projects/:id/media-packages`，正文增加expectedSnapshotHash，头部携带UUID Idempotency-Key。同键重放返回原清单，改变选项或预检哈希会冲突。创建前及原件检查后均复查状态。
- `GET /projects/:id/media-packages?cursor=...`，每页20条创建记录。
- `GET /media-packages/:id`，读取固定manifest与元数据。
- `GET /media-packages/:id/file`，下载application/zip，按确定长度流式返回。文件条目按固定顺序、固定ZIP元数据写出。

创建/历史/详情返回layout（media/delivery）表示实际固定格式；切换layout会改变预检哈希，旧确认或同键不同格式被拒绝。快照及文档存入原有不可变JSON，无数据库迁移。

ZIP写入依赖yazl 3.3.1及其buffer-crc32 1.0.0，已核对安装包MIT许可证，版本及完整性记录在package-lock.json。开发类型包为@types/yazl 3.3.1。实际使用的流式接口参见 [yazl 官方说明](https://github.com/thejoshwolfe/yazl#addreadstreamlazymetadatapath-options-getreadstreamfunction)。
