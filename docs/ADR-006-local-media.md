# ADR-006：Local 媒体、不可变版本与登记恢复

状态：采用。2026-11-05。保持 ADR-001/002/005 和现有数据兼容。

媒体原件不放进 SQLite，也不借用文本导出 BLOB。仅追加五张表：storage_connections、media_assets、media_versions、media_uploads、takes；旧表/编号/来源/卡/提示词不迁移或重写。media_assets 是媒体集合身份，后续人物/场景/道具等语义实体另建并引用固定媒体版本，不能把文件夹当人物库。

共享 StorageProvider 端口提供有界 stage、publish、stat、校验读取及 staging 清理，不提供业务物理删除。当前真正实现的只有 LocalStorage；服务端配置一个媒体根，稳定 UUID 根标记登记为 storage connection。媒体业务仍直接注入 Local adapter，FFprobe 使用受控临时本地路径；完整多后端路由 Facade、Mounted/S3、远程对象下载到本地探测尚未实现，后续按此端口/稳定存储 ID 增量建设，不把本地路径暴露给前端或 Provider。

每次上传尝试有独立目录及租约。原件/封面写完并同步文件后，以同卷目录 rename 发布；SQL 事务随后原子保存媒体、版本及审计。文件系统与 SQLite 没有分布式事务，故在发布前持久化准备证据，发布后 SQL 失败保留文件并进入 needs_reconciliation。重新校验后再登记；不能以删除已发布文件掩盖异常，不能把尚未归档结果报完成。目录 rename 不代表突然断电的所有文件系统都能保证目录元数据持久化，启动/读取与备份校验仍须核实实际文件。

media_versions、storage_connections 和 Take 身份有不可变触发器，media_assets 仅允许版本递增。Take 当前为 draft 固定引用，后续审批以追加决定/投影演进，不覆盖旧身份/文件，也不自动重写镜头卡。并发追加以素材 expectedVersion 拒绝覆盖；冲突遗留原件保留，后续须提供明确的重新归属/保留期/GC 流程，当前不伪造恢复成功。

根目录只由管理员环境配置。新空目录不能接管旧根 ID；完整搬迁需数据库、根标记、原件/封面一起复制并校验。在线数据库备份不等于完整媒体备份；现阶段停写后复制、使用 media:verify 验证副本，未来一键备份要协调写入窗口与对象清单。

SHA256 属于内部完整性证据，保留在数据库/API/备份清单；按用户意见不在日常创作界面展示。预览保留用户可理解的文件名、版本、尺寸、时长和状态。
