# B7 同任务批量主结果

基线 ab5a571。复用 B6 的 Generation/Worker/MediaService/Storage、产物选择、入库和固定画布引用，不创建第二队列，不自动多次调用模型。

## 范围与修改合同

- 工作流 `output.batch` 为可选 `{id: UUID}`，配置界面自动生成并在固定修订中保留；开启后接受该主输出字段的 1–8 份文件，未开启仍恰好一份。数量由工作流原参数决定，不伪造通用次数参数。首份仍采用 job.mediaVersionId/result 和 jobId 结果节点；其余主结果复用 generation_outputs 及 outputId。旧 Shot/Take 和 ModelScope 不接入批量。
- DB 0052 增 generation_outputs.primary_index 可空列及保护触发器，兼容扩展原完成门禁以接收批量，不重建表、不改变旧行，原扩展总数限制继续保留。为兼容既有 role 约束，额外主结果的归档 role 保持 intermediate，primary_index 明确标记其主结果序号并优先决定公开 API/界面角色 primary。既有 preview/intermediate 为 null；API 不暴露存储回退角色。批量 id 与其他槽位/公开字段 id 不得重叠。
- Provider 在下载前固定完整清单：单批主结果最多 8 份，原扩展上限 32 份不变，总文件最多 40 份。重复描述、缺失、超量、临时文件和类型不符都拒绝，不截取。manifest 保持 v1，增加可选 primaryIndex；快照 primaryBatch 及旧 Worker 领取保护确保旧代码不处理新批量任务。
- Worker 复用原归档和逐份恢复。所有文件归档成功才完成；只返回已完成任务的完整产物列表。第一份不重复登记到产物表。批量仅返回一份也合法，仍固定空扩展清单。旧扩展任务和固定结果不变。
- API 保留主结果字段；outputs 中额外主结果 role=primary、index 为实际批次序号（从 1 开始，界面显示第 2 份）。选中任一文件仅保存这一份，可加入独立画布节点、作为后续参考、下载及预览。试跑仍隔离。
- 修改路径：generation-contract/output-contract、Comfy Provider、GenerationService/Worker、db/schema/0052；GenerationSettings/workflow-types、GenerationOutputPicker/GenerationDialog。固定 Board/Media/RBAC 流程沿用 B6。

## 验收与故障

隔离数据库与 Mock 模型，实际文件字节。覆盖未开启拒绝多文件、开启后单份/多份、三种媒体类型、超量/重复/类型错误、部分下载和登记失败恢复、固定修订/清单、旧 Worker 拒绝、试跑隔离、只读/跨项目拒绝、逐份入库和固定结果节点。浏览器检查配置保存与修订、候选切换/下载/画布复用、桌面/手机与旧单结果回归。正式库不作测试样例，生成 SQL 前在线备份，副本迁移比对全部旧表和历史记录。真实模型与高负载验收独立进行。

2026-11-07 完成：API 274 项、画布 33 项、工作流 20 项、图解析 4 项全量通过，构建、类型和格式通过。已执行 8 份主结果和 32 份扩展文件合计 40 份真实测试文件归档；下载中断、登记故障和远端历史变化后均可从固定清单恢复，不重复下载完成文件。浏览器验证独立入库、固定节点、第二份图片继续用于图生视频、键盘配置开关及旧修订不变；实际检查桌面和 390px 手机截图。

生成前备份：`data/backups/studio-2026-11-07T04-40-06-587Z-212ee112.sqlite`。副本验证 42→53，55 张旧表内容和迁移记录前缀不变；另从已有 6 份旧扩展产物的测试库验证 52→53，68 张旧表原列内容不变，新增主结果序号均为空。两条路径完整性 ok、外键错误为零。记录 `data/e2e/b7-migration-check.json`；正式库只读检查仍为 42 条迁移，未应用本包。测试使用 Mock，不代表具体模型实机兼容性已验收。
