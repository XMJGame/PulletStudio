# ADR-010：ComfyUI独立实例与正式画布边界

状态：采用用户G1指令确定的V1架构，2026-11-05。G1只冻结边界，不实现完整调度。

V1使用普通ComfyUI原生POST /prompt，支持后续多个独立实例；不接ComfyUI-Distributed专用API、Collector或Distributed Seed。主栈、现有Generation队列/归档/Take审核保留。旧MASTER中的Distributed专用提交策略不再作为V1任务。

后端管理实例身份/名称/受信API地址/加密凭据、启用/健康、模型节点能力、并发/队列容量与工作区授权。默认auto按确切工作流依赖、权限、健康和容量选机；高级manual只列有权且能力匹配的实例，指定实例不可用须明确失败/等待，不能未经同意切到另一机器。

画布只调用Pullet Generation API，不直接调用ComfyUI。Job冻结Workflow身份/修订、参数、固定输入媒体、实际实例、Job/外部Prompt ID、输出媒体与失败历史。端点、令牌和物理路径不进入Board JSON。现有工作流绑定单连接是已实现兼容范围，未来多实例必须另做绑定/能力校验/快照迁移合同，不能冒称auto已经可用。

实施顺序：G1正式Board/引用/权限→G2复用现有镜头生成闭环→独立实例管理/auto/manual调度与双机并行真实验收→团队批次/交付/部署。无需为G1提前增加实例空表或第二队列。用户环境地址只留本机受控配置，不写源码/样例或此文档。
