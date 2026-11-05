# Phase C1/C2：本地媒体归档与镜头候选实施合同

2026-11-05，编码前记录。保留现有主栈、编号、正文/卡/Prompt/导出历史；本包打通手工文件→真实检测→不可变媒体版本→鉴权预览/下载→镜头候选，不调用外部模型、不扫描 ComfyUI 输出目录。语义角色库、正式 Take 审批/选片、Mounted/S3 和生成任务后续扩展。

- 代码：新增 API storage/（共享端口与 Local adapter）、assets/（上传、探测、版本、分发、候选），注册 app.module，配置/示例/CI；Web新增 MediaDialog/流式请求辅助，接入镜头编辑器和制作结构。演进 contracts/storage 草案为当前真实端口，不暴露任意物理删除给普通调用者。多后端路由 Facade 随后续真实后端增量实现。
- 数据：只追加 storage_connections（稳定根标记ID，不保存/回传真实根路径）、media_assets（稳定身份/当前版本）、media_versions（原件/衍生封面键、hash/大小、实际媒体元数据、来源）、media_uploads（持久化上传意图/幂等/租约/恢复）及 takes（手工draft候选，镜头范围内后台编号）。不重建旧表，不复制业务镜头，不伪称候选已批准。
- Local 根仅进程环境 MEDIA_ROOT 配置，默认数据库同目录/media；API不得接受路径/远程URL。工具只读已知受控本地文件，FFprobe检测，FFmpeg生成JPEG封面。Windows开发工具下载至忽略目录，保留发行版许可证/校验记录，不上传二进制，不改系统PATH；CI使用系统ffmpeg。缺工具只阻止媒体导入，不阻止登录/文本制作。
- Storage契约：stage有界AsyncIterable、stat、校验后read/range、同卷原子发布目录、staging清理；默认无业务删除。对象键仅服务端UUID/固定段，逐段lstat/realpath拒绝穿越/符号链接/junction/特殊文件；读打开后fstat核对身份。根标记与storage ID稳定，改为空根不会把旧素材静默指到新位置。后续搬迁须保留标记/对象并校验。
- 原件上传：POST /projects/:id/media-uploads（名称/大小/MIME提示、可选assetId+expectedAssetVersion，UUID幂等键）；PUT /media-uploads/:id/content 为原始字节流，不用multipart内存缓存。大小/超时/并发有界，后台SHA256、fsync、文件魔数和实际流信息校验；PNG/JPEG/WebP、MP4/MOV/WebM、WAV/MP3/OGG首批。SVG/HTML/播放列表、错误MIME/后缀、截断/坏媒体拒绝。
- 首批默认单文件512MiB，服务端可配置更小值，受控上限2GiB；全量重传，不冒称断点续传/多GB实测。最多2个并行接收，上传/工具有界超时、工具限制协议/格式/线程/输出，探测结果只留允许字段，原始tags不回传。原件保持字节与hash，封面去元数据；原件可能包含EXIF，下载须知但不修改原件。不是完整恶意媒体沙箱/病毒扫描。
- Session状态 created/uploading/complete/failed/needs_reconciliation；事务CAS领取/租约/心跳。中断/过期在读取/恢复时识别；半文件只清理本会话staging；原件+封面同目录原子发布后再事务登记媒体/版本/审计。发布后SQL失败保留归档文件，转needs_reconciliation，POST .../reconcile重新校验后登记，不盲目重传/删除原件。并发新版本以资产版本CAS防覆盖。
- API：GET /projects/:id/media-status、/media-assets、/media-uploads；GET /media-assets/:id/versions、GET /media-versions/:id；GET /media-versions/:id/content|poster（鉴权/Range/安全类型/附件、no-store、SHA256）；GET /media-uploads/:id；POST /media-uploads/:id/reconcile；GET/POST /shots/:id/takes。上传/新版本/候选要edit；读取要项目read；上传恢复仅发起人或有管理权限者。所有资源回收站/撤权即时拒绝。
- Take只关联同项目固定mediaVersion，explicit expectedShotVersion，后台分配takeNo，相同镜头/版本重复请求复用，不自动改正式卡或选中/批准。图片视频音频均可作为候选媒体，版本追加不替换已关联旧候选。生成来源/Prompt绑定在真实生成消费时扩展。
- UI：项目素材入口/镜头素材入口；选择文件→上传/失败保留选择/查看持久化结果→播放/原件下载/历史/上传新版本→明确添加为当前镜头候选。素材预览按浏览器实际能力提供兜底下载，不把未支持编码显示成成功播放。手机滚动、按钮、键盘；断线/响应丢失以session状态恢复，不重复归档。
- 验证：隔离媒体根+DB，实际ffmpeg合成图片/短视频/音频；流式上传/hash/元数据/封面/Range/原件不变；伪类型/坏文件/路径/符号链接/越权/失权/回收站/并发/超限/中断；故障注入磁盘/SQL、租约/重启/归档调和、旧媒体版本/Take引用；浏览器实际上传/播放元信息/下载/手机/失败恢复。现有96测试不回退，迁移前在线备份并核对旧记录。
- 备份/回退：DB备份不等于媒体备份；本包需提供媒体清单校验/完整复制恢复说明和独立恢复验收，包含根标记、原件、封面与DB。无物理清理/自动GC；停写后复制媒体、校验hash，再用新路径+匹配代码恢复，不覆盖运行库。新版本和文件不在旧备份内，保留当前库与文件，不能逆向删新业务数据。

实施补充：用户要求常规界面不展示 SHA256；后台/接口/清单保留校验。已实际验证 MOV/M4A/Opus，与上述格式一并支持。完成证据和剩余边界见 IMPLEMENTATION-STATUS / LOCAL-MEDIA。
