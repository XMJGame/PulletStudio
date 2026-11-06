# L2-C 画布单节点执行合同

2026-11-06，基线fe05fd3。复用Board、不可变修订、Generation/Worker/Storage、工作流配置及项目权限。首批显式执行TEXT＋单IMAGE→已配置I2V，也允许现有T2I/T2V，不运行整张图、不接任意脚本。

## 修改范围与兼容

- `boards/board-contract.ts`、共享Board类型：新增generation、result节点；input_binding边具名text→prompt、image→first_frame。旧无kind边仍为annotation，禁止推断执行。直接选择输入同样创建input_binding边，没有第二套输入状态。
- 原计划建议Board v2。审查发现现有表CHECK固定v1，本批字段可兼容扩展，因此保持studio.board.v1，避免无必要重建表。旧JSON/请求哈希保持原值；未来不兼容变更才升主版本。无需SQL迁移或新依赖。
- generation保存固定workflowId及公开参数/字段，不保存地址、凭据、原始技术图或运行状态。便签提供完整正负词/来源；首帧只来自同项目固定图片媒体或已完成图片结果，不默认取角色任意预览图。
- 新`BoardGenerationService/Controller`：POST boards/:id/nodes/:nodeId/generation-jobs，输入expectedRevision、confirmed、可选routing，服务端从已保存最新修订解析；GET同路径分页历史。Job快照冻结boardId/revision/nodeId、输入节点及请求指纹。旧通用API不能伪造此上下文。
- POST沿用原Generation创建：权限、工作流状态/参数、库来源、首帧、实例预留、审计及Worker重查；立即事务内编译和入队。重放先查已存在Job并核验请求，不因画布已更新而重复提交。新请求的过期修订409；未保存输入不能执行。
- result节点只保存jobId；读取时重查同项目正式通用任务，再解析固定媒体，试跑/跨项目禁止。以jobId作确定性节点ID，重复加入/刷新/恢复不重复复制媒体；生成不会自动入项目库。
- Web单独`BoardExecutionPanel`，复用工作流字段表单及现有任务状态；选择/连线输入、参数保存、执行、分页任务恢复、加入结果、预览。执行要求当前画布无草稿且有编辑权限；失败保留输入/请求键。结果由用户加入画布并保存，不自动改写协作者的画布修订。

## 验收门禁

旧v1回归；类型/重复端口/自环/缺失节点/超量拒绝；连线与选择同合同；无Shot文本/首帧Mock实际提交；保存后变更工作流/库/画布不改任务；CAS及丢响应重放；跨项目、只读、撤权、回收站、禁用连接/归档；结果重复恢复、媒体失效占位；桌面/390px、键盘、重启/备份。现有真实设备不自动调用。
