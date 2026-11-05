# 本地媒体与镜头候选

2026-11-05，Phase C1/C2。无需配置模型即可导入已有图片、视频和音频。语义人物/场景/道具/声音角色及固定引用现已由 [C3/C4 资产库](SEMANTIC-ASSETS.md)提供草稿基础；媒体生成、正式审批及选片尚未交付。实施合同见 [LOCAL-MEDIA-IMPLEMENTATION](modules/LOCAL-MEDIA-IMPLEMENTATION.md)，兼容决策见 [ADR-006](ADR-006-local-media.md)。

## 使用

进入项目“制作结构”→“项目素材”，或打开镜头→“镜头素材”。选择文件后点击“上传并归档”。后台核对实际文件内容、大小和媒体流，图片/视频生成独立封面；完成后才能预览、播放及下载原件。

“上传目标”默认新建素材，也可选已有素材追加版本。旧版本与原件保留；既有镜头候选固定引用原版本，不会随着素材追加而改变。选择版本后明确点击“添加为当前镜头候选”，系统生成 Take 编号。候选尚未审核，不自动替换制作卡，也不是已批准成片。

文件名、版本、尺寸、时长和声音流情况在界面显示。按用户要求，原文、媒体和分镜导出界面均不展示 SHA256 长串；后台、API、固定导出数据及备份清单仍保留校验信息。

上传或添加候选需要项目编辑权；预览/播放/下载需要读取权。恢复登记只允许上传发起人或项目管理者且仍有编辑权。撤权或项目进入回收站后，旧下载链接同样失效。浏览器未支持某编码时显示播放失败，可下载原件；支持容器不代表浏览器支持全部编码。

声音样本补充规则：一旦固定媒体版本被资产库引用为 voice_sample，文件仅允许上传者、项目管理者/审核者、工作区管理者读取且仍须能访问项目。普通项目读者可看声音设定及样本元数据；历史引用保护不会随新修订清空而解除。详见 [声音样本权限](SEMANTIC-ASSETS.md)。

## 安装与配置

登录和文本工作不依赖 FFmpeg。媒体导入需要服务端可执行的 `ffmpeg` 和 `ffprobe`，无需改动现有 ComfyUI。

- Linux 可使用发行版提供的 FFmpeg；CI 已增加安装步骤，远端本包尚未运行。
- Windows 可放入忽略目录 `data/tools/ffmpeg/bin/`（两个 exe），保留发行包许可证/说明。也可在 `.env` 设置 `FFMPEG_PATH`、`FFPROBE_PATH`；不自动修改系统 PATH。
- 本机验收使用 FFmpeg/FFprobe `9.0.2-essentials_build-www.gyan.dev`。下载来源是 [FFmpeg 官方下载页](https://ffmpeg.org/download.html)列出的 [Gyan builds](https://www.gyan.dev/ffmpeg/builds/)，`ffmpeg-release-essentials.zip` SHA256 为 `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`，已对照发行方校验文件。该包附 GPLv3 LICENSE；二进制、压缩包和许可副本仅在本机忽略目录，没有纳入源码提交或软件分发。未来打包分发需单独处理所用构建及编解码器的许可义务。

可选环境变量：

| 设置 | 默认/限制 |
|---|---|
| `MEDIA_ROOT` | 数据库所在目录下 `media`；专用本地目录，只由服务器环境指定 |
| `MEDIA_MAX_BYTES` | 536870912（512MiB）；允许 1–2147483648 |
| `MEDIA_UPLOAD_TIMEOUT_MS` | 600000；允许 1000–1800000 |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Windows 优先上述本地工具目录，否则从 PATH 查找 |

更改环境后重启 API。数据库仍必须放在服务器本地持久化磁盘，不能放在 SMB/NFS。当前只验收 Local，不宣称 Mounted/NAS/S3 可用。不要把私有路径、密钥、数据库或媒体文件提交到 Git。

## 当前范围与限制

- 已测 PNG、JPEG、WebP；MP4（含声音）、MOV、WebM；WAV、MP3、OGG、M4A、Opus。扩展名、声明 MIME、魔数和实际流需要一致；SVG、HTML、播放列表及无效文件拒绝。
- 逐块写入及 SHA256，不将整文件装入 API 内存；默认最多两个同时接收/检测任务。单次默认512MiB，但本轮实测为合成小文件，未测多GB、压力或80分钟作品。
- 图片/视频最大单边16384、4000万像素；音视频最长24小时、最多32条流。FFprobe/FFmpeg 有超时、协议/格式白名单及输出限制。检测元数据和首帧解码不等于完整视频逐帧验证、杀毒或操作系统沙箱。
- 原件字节不改写，可能含 EXIF 等元数据；页面仅展示允许字段，派生封面去元数据。后续音轨处理生成新产物，不改源片。
- 文件键由后台 UUID 生成；客户端不能提供磁盘路径或远程 URL。拒绝穿越、symlink/junction、硬链接和特殊文件。服务端媒体根及父目录应由服务账户控制，不支持敌对本机账户持续替换目录的环境。
- 本包没有物理删除、自动 GC、项目配额、分片/断点续传或存储管理界面。上传失败保留文件选择，重传整个文件；历史不会自动清理。

## 上传恢复

持久化状态为 created、uploading、complete、failed、needs_reconciliation。任务有幂等键、租约和心跳；每次尝试使用独立 staging 目录。上传后原件和封面以同卷目录 rename 发布，再以一个事务登记素材版本和审计。

- 浏览器停止等待或网络断开：先点“查看状态”。服务端可能已完成；读取持久化结果可避免重复上传。页面刷新后仍可从自己的上传记录恢复，但浏览器文件选择需要重新操作。
- 传输中断/超时且租约过期：查看状态会判定 failed，只清理该次尝试的 staging 文件；可重新发送整个文件。
- 文件已发布但数据库登记失败：保留归档文件，进入 needs_reconciliation，点击“重试登记”，后台重新核对原件/封面后登记，不重复传输、不删除已归档文件。
- 两个上传竞争同一素材版本：只允许一个版本推进，另一个保留文件并报冲突。当前不能自动改挂素材或修改固定上传意图，也没有丢弃归档/GC API；先保留现场，后续运维能力处理，不用手工 SQL 改版本或删原件。清单工具会报告此类未解决任务。
- 工具不可用、根目录不匹配或哈希不一致：如实报错，不能将文件标成成功。恢复正确工具/目录或从完整备份恢复，再检查状态。

## 备份、校验与恢复

`npm run db:backup` **只备份 SQLite**，媒体不在数据库内。完整备份需要数据库、完整 MEDIA_ROOT（含 `.pullet-storage.json`、所有原件/封面及未解决现场）和匹配代码/配置；Provider 主密钥、部署配置另行安全保管。不要把运行中的 `.sqlite` 直接复制当作在线备份，也不要只复制 `workspaces` 子目录而漏掉根标记。

1. 先完成或核对 uploading/needs_reconciliation，停止新增写入，停止 API/相关 Worker。当前没有一键停写快照工具，需要操作者保证备份期间没有新写入。
2. 在仓库根目录执行 `npm run build`、`npm run db:backup`，记录新备份路径。在停写窗口把整个媒体根复制到新的备份目录，不覆盖现有备份。受保护媒体不使用硬链接、junction 或符号链接备份。
3. 对这份数据库副本和媒体副本执行只读验证（把路径换为实际副本）：

   ```powershell
   npm run media:verify -- --database "D:/Backups/studio.sqlite" --root "D:/Backups/media" --out "D:/Backups/media-manifest.json"
   ```

   命令不修复/删除对象；校验数据库完整性/外键、根 ID、已登记原件与封面的字节数/SHA256，逐文件读取，不将所有媒体装入内存。输出文件用独占创建，不覆盖旧清单；正常应为 valid=true、pendingUploads=0、errors=0。清单以相对键列出登记对象，不等于包含未登记归档/staging 的全盘目录清单，也不是可重导入项目包。
4. 恢复时保留当前数据库和文件，把备份复制到**新的路径**，设置 DATABASE_PATH/MEDIA_ROOT 指向配套副本，保留原根标记。先用上述命令验证，再启动匹配代码、登录并检查原件/封面/历史/播放。更改到空媒体根会生成不同 storage ID，旧版本应明确不可用，不会静默重绑定。
5. 需要回退代码时，使用匹配迁移前数据库与媒体备份的新路径；不倒删新表、记录或文件。备份之后的新内容不在旧副本中，必须另行保留。

本包隔离测试实际完成了含图片/视频/音频、封面、固定 Take、数据库的复制恢复与完整清单比对，也验证未解决任务不能被报告为干净备份。本机正式库没有放入样例媒体；零文件清单通过仅说明正式库当前无媒体，不替代以上有媒体恢复测试。

## 接口

接口均在 `/api/v1`，沿用现有会话/RBAC/CSRF：

- 项目：`GET /projects/:id/media-status|media-assets|media-uploads`；两类列表20条/页，`cursor` 为服务端返回ID，按创建时间/ID倒序。
- 上传：`POST /projects/:id/media-uploads`（UUID Idempotency-Key，文件名/大小/MIME提示及可选 assetId/expectedAssetVersion）；`PUT /media-uploads/:id/content`（application/octet-stream 原始流）；`GET /media-uploads/:id`；`POST /media-uploads/:id/reconcile`。
- 历史：`GET /media-assets/:id/versions?before=版本`；`GET /media-versions/:id`。
- 读取：`GET /media-versions/:id/content`、`/poster`；content 的 `?download=1` 强制附件。支持单段 bytes Range（206/416），校验后读取、no-store、安全文件名与类型、X-Content-SHA256；不公开目录/对象键/存储根。
- 候选：`GET /shots/:id/takes?before=编号`；`POST /shots/:id/takes`（mediaVersionId、expectedShotVersion）。只能关联同项目固定版本，相同镜头/版本重复请求复用旧候选。
