# ADR-004：制作层级复用既有分集存储

状态：采用。2026-11-04。

现有 episodes 已有稳定 UUID、项目/工作区复合外键、显示编号、排序、版本和镜头计数器。将其增量扩展 unit_type、parent_id、outline、target_duration_seconds，并通过 UnitsService 映射为 ProductionUnit；物理表名保持不变，不复制或同步两套分集数据。旧行默认 episode，旧接口只返回 episode；新接口提供统一树、根/子节点及稳定分页。

Shot 保留 episode_id 外键，该列在新结构服务语义上是所属制作单元 ID。对直接项目镜头，按需建立 project_root 内部行，每项目最多一个；该行只承载外键/编号，不是用户的分集或场次，不在树、分集列表及父选项出现。对外 unitId=null，拒绝用户手动创建/编辑此内部行。业务编号由服务分配，所有旧 Shot ID/编号/外键不变，无表重建。

项目其他单元仍用同一张表，支持 episode/act/chapter/sequence/scene/section；parent_id 同项目外键检查、循环检查在事务及 DB 触发器实施。编号不随排序、改名或重挂父节点改变。仅新增单元使用新类型，已建立单元的类型暂不提供修改。

成本：物理表/旧接口保留 episode 名称；领域及新 UI 使用 Unit。后续可在有独立数据迁移验收时重命名，当前不为名称一致而重建用户表。跨单元镜头移动及生命周期在另一个增量实现，避免改变现有作用域编号语义。
