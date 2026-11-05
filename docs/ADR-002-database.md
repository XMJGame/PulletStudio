# ADR-002：SQLite 与增量演进

状态：采用。2026-11-04。

V1 保留 better-sqlite3/Drizzle、WAL、foreign_keys=ON、busy_timeout=5000、FULL synchronous、短事务、版本条件更新。数据库在本地持久化盘，不能放 SMB/NFS；单 API 实例及同机 Worker，不宣称多主机数据库能力。PostgreSQL 是独立迁移项目，当前没有驱动或双库开关。

旧 episodes/shots/scripts 是真实数据，不直接替换。ProductionUnit 用增量关联和兼容接口演进，编号和 UUID 保留。旧历史触发器保留；新增证据/审核使用附表或追加事件。

执行版本化增量迁移前做在线备份，测试用隔离数据库。恢复复制快照至新路径并检查，不覆盖运行中的 DB。小型原始剧本文本可在有界 script_sources BLOB 中事务保存，媒体对象在后续 StorageFacade 管理；未来来源迁移以 ID 和 checksum 保证一致。
