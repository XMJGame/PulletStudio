# 项目设定与制作结构

新建项目可选择空白、对白短片、旁白长视频、产品广告或连续剧起始模板，只提供可修改的格式、叙事方式和目标时长初值，不绑定风格或模型。“格式、叙事与导演设定”可展开补充导演创作说明；目前不是正式版本化 DirectorProfile。

格式为 custom/short/longform/series/film/ad/mv/documentary；叙事为 none/narration/dialogue/hybrid/music_driven；项目时长可空，非空为 1–28,800 秒。旧项目默认 custom、none、时长未设定，不推测或改写既有创作。

已有项目修改创作设定时先显示影响范围，点击“确认并保存项目设定”才写入。原剧本、结构、镜头及其时长保持原样，后续 AI/提示词需重新提出候选。项目时长不会自动平均分配。

## 制作结构视图

- “项目直属镜头”可直接添加镜头，广告/短片无需先建分集。
- 制作单元支持分集、幕、章节、段落组、场次、段落及嵌套上级。选择“项目直属”放顶层，禁止循环与跨项目父链。
- 可编辑名称、上级、排序、概述、时长；类型建立后暂不修改。系统生成编号：分集 EP01，其他单元 U0001，镜头在各自范围 SH001。改名、排序、单元改上级不改 ID/编号。
- 镜头制作方式可选择静态画面、静帧动效、文生视频、图生视频、视频编辑和外部工具；保存的是计划，不自动调用模型。手动时长初值不等于旁白对齐。
- 结构/镜头分页加载。未加载的上级会提示；编辑时保留未加载的父关联，不偷偷改为根节点。
- 双窗口冲突返回 409 并保留输入；加载最新单元会替换表单，请先复制需要的本地修改。

旧分集与新树共享同一身份与数据，原故事板继续可用。单元删除、跨单元移动镜头、拖拽尚未实现。

## API

路径以 `/api/v1` 开头，沿用工作区/项目授权、CSRF 和版本锁：

- 项目创建/修改新增 workFormat、narrativeMode、targetDurationSeconds、directorNotes。`POST /projects/:id/settings-impact` 接同项目 PATCH 内容及 expectedVersion，返回 changedFields、units、shots、scripts、requiresConfirmation、warnings。PATCH 需要确认却未传 acknowledgeImpact=true 时返回 409 IMPACT_REVIEW_REQUIRED；项目旧版本仍返回 VERSION_CONFLICT。
- `GET /projects/:id/units?cursor=UUID&limit=100` 返回 `{items,nextCursor}`；按 ID 分页，页面按 orderIndex 呈现树。
- `POST /projects/:id/units` 接 `{kind,title,parentId?,orderIndex?,outline?,targetDurationSeconds?}`。
- `GET/PATCH /units/:id`；PATCH 接可编辑字段及 expectedVersion，不接受手填编号、类型或项目 ID。
- `GET /projects/:id/shots?unitId=UUID&cursor=UUID&limit=100`；省略 unitId 为项目直属镜头，返回 `{items,nextCursor}`。
- `POST /projects/:id/shots` 接旧镜头字段加 unitId?（可空）和 technique?；编号及未给定的顺序在事务内分配。
- `PATCH /shots/:id` 沿用旧版本锁，新增可选 technique。

回收站项目拒绝全部结构/镜头读写，只读成员仅可查看。内部 project_root 行不出现在树/分集列表；对外直属镜头 unitId=null，用户不能手动创建、读取、编辑内部行或用作父节点。

## 迁移与恢复

0008_sparkling_wallop 追加项目设定、单元类型/父级/概述/时长、计数器、索引及镜头制作方式；旧分集默认 episode，旧镜头默认 unspecified。0009_unit_hierarchy_guards 添加父级范围、循环和类型不可改触发器。旧主键、表、复合外键、计数器、版本保留。

迁移前备份为 `data/backups/studio-2026-11-04T12-13-34-993Z-3316526a.sqlite`。回退时停止服务并保留当前库，将备份复制到新本地路径，修改 DATABASE_PATH 后重启检查；不能覆盖运行中的库。旧快照不含迁移后新增数据，详细恢复步骤见 `05-DEVELOPMENT.md`。
