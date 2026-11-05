# 已选素材包导出实施合同

复用 StoryboardExportsService 的范围、排序及制作卡采集，TakeReviewService 的选片有效性，MediaService 的读取授权和 LocalStorage 原件校验。保留 NestJS/React/Drizzle/SQLite 和存储 Provider 边界。ZIP 使用 MIT 的 yazl 流式写出，固定条目元数据，按顺序读取原件。

- 范围复用项目、直属、单元（含子级可选）、指定镜头。上限100镜头、原件合计2GiB、清单4MiB。预检列出缺选片/失效批准/受限文件等问题，整个所选范围有效才允许创建。去重按固定媒体版本进行，内部路径由服务端ID和已验证MIME扩展名组成。
- 增量新增 media_package_exports，保存不可变 manifest.json、请求键/哈希、范围与快照哈希、创建者/时间及数量。先核对数据库及原件，再在事务内复查输入、权限、幂等和审计，保存固定交付清单。状态明确为 snapshot_ready，下载时流式组装 ZIP。生成迁移文件前已完成在线备份。
- manifest 记录项目设定、制作层级、镜头顺序/完整卡、确切 Take、选片事件和批准记录、固定媒体路径/大小/哈希/探测元数据，以及生成任务/参数/确切 PromptArtifact。手工关联来源为空。只包含本次选片原件，参考素材的固定引用留在清单中。Provider 端点、凭据、存储绝对路径和完整工作流图留在平台。
- POST /projects/:id/media-packages/preview 返回预检及 snapshotHash。POST /projects/:id/media-packages 携带 scope、expectedSnapshotHash、UUID Idempotency-Key。GET 同一路径分页历史，GET /media-packages/:id 返回固定清单，GET /media-packages/:id/file 下载 ZIP。
- 创建要求项目读取权限和所有包内原件读取权限。异步文件检查后复查预检哈希和授权。历史清单保留创建时的批准依据，后续项目变化或选片调整不改写既有交付快照。历史下载重新核对当前项目与受保护声音权限、存储根及文件完整性。每文件开始/结束均核对权限，文件校验失败或断连时终止流并关闭原件。
- 前端新增素材包 Dialog，接入项目工作台。展示范围、待处理镜头、原件总大小、确认创建、历史与ZIP下载。变更范围清除预检，409保留选项并要求刷新预检，失响应同键重试。普通界面显示名称、数量、大小与状态。
- 自动测试隔离数据库，验证ZIP可读、manifest及逐文件字节/哈希、重复媒体去重、预检阻塞/变化、权限/跨租户/声音限制、并发幂等/审计回滚、文件破坏/缺失、下载断连、旧包确定性、分页、重启与备份。Edge 验收范围、阻塞、预检、失响应重试、下载、历史和手机布局。

本包交付剪辑素材及来源清单。完整可重新导入的项目包、预演、时间线、SRT 和大包异步任务后续实施。
