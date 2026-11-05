# 团队 V1 技术规格差异审计

2026-11-05；本地与 origin/main 同为 9c0ad77，开始时工作树干净。两份用户文件原样归档为本目录 REPOSITORY-CONTINUATION-PLAN.md、TEAM-V1-TECHNICAL-BLUEPRINT.md。本文为这次差异判断，不是第二份实时计划；结果和测试统一维护在 IMPLEMENTATION-STATUS。

| 蓝图模块 | 代码事实/可复用 | 差异及下一步验收 |
|---|---|---|
| A 制作卡/Prompt/文本交付（Phase B） | analysis-contract、shot-cards、ProposalReview、ShotEditor 已有候选全字段和只读正式卡、原文关系；基本镜头写入会续写历史 | 正式全字段/手动卡编辑、Profile/Compiler/Artifact/导出未实现。先解决非 AI 卡兼容、共享版本读写；再离线预览/保存完整词、stale 与历史；后做 MD/JSON/CSV。双人 409、旧来源、无模型、对白/广告/旁白、CSV 防护逐包验收 |
| B Storage/媒体（Phase C1/2） | backup、授权、受信 HTTP 原则可复用；contracts/storage 只是草案 | 无文件服务/元数据/Range。流式 staging→hash/探测→commit→授权预览；路径、symlink、伪 MIME、限额、失败补偿和原件哈希验收 |
| C 资产 Bible（Phase C3/4） | 项目/工作区权限、不可变修订模式可复用；候选 assets 目前只是名称文本 | 新建语义资产与媒体版本分离的实体、引用及影响查询；角色锚点/多视图、场景/道具/声音版本，不以字符串冒充批准参考。需依赖 B |
| D 生成（Phase D） | Text worker 的租约、取消/调和、凭据和 SSRF 思路有效；text 队列不能作媒体归档 | 新媒体契约/任务/输出/Take/Worker，绑定动态能力；Mock 后真实 ComfyUI 图/视频归档。Completed 必须本地产物完整，未知提交不重发；依赖 Storage |
| E 团队（Phase E） | RBAC、Reviewer 独立权限、Proposal 门禁、审计、乐观锁已实现 | 缺任务指派、Take 审批/评论/站内通知/Batch dry run。3 账号、2 项目、20 镜头和失败项重试后验收，不重做成员模块 |
| F 后期（Phase F） | 现有整数秒仅镜头计划；音频说明只是文本 | 新声音策略/媒体元数据/VO/整数 ms 时间线/预演/项目包；不可修改源音轨，30–60s 真实样片/哈希重导入验收 |
| G 画布/Skills（Phase G） | 当前列表/结构共享 Shot ID，Provider/Storage 分界已定 | 无 Board、Skills、Recipe、Agent。后续 React Flow 只存布局和业务引用，类型边/循环后端验证。受限源码不复制；无第三方任意脚本执行 |
| H UI（并非独立全站重写） | main.tsx、style.css、Dialog、Structure/Analysis/Script 工作台可复用，已有手机和焦点测试 | 路由/AppShell/token 随功能渐进抽取，保留现在可用页面。配色不强制；本包复用组件，手机表单滚动/按钮和失败输入保留优先 |
| 工程/发布（Phase A/H） | 24 表/14 迁移、WAL/在线备份、Node/Edge、CI 文件已有 | 当轮重新跑实际检查；独立副本恢复。旧 Compose 示例明确隔离，尚无可用 SQLite Compose；远端 CI 单独核查，不以本地通过代替。部署/SDK/SBOM/规模验收后置 |

保留：所有旧 SQL/业务表/认证/编号/脚本/审核/worker/测试。整理：文档优先级与历史数字；主模块、schema 和 UI 文件暂不为拆分而改动。归档候选：旧 Postgres/Redis Compose 已标为历史示例，没有 npm/CI 引用，当前不启动或删除。新增：本轮只建卡人工修订、PromptProfile/Artifact 的实际消费链，其他未来表不提前铺空壳。

参考源码按模块定向研究：A 借鉴 ZenStory 的完整可读产物与逐批确认、shuohao 的质量门禁；B/C 学主锚点/固定版本；G 再研究 LocalMiniDrama 同源双视图、DramaClaw 提升边界、Huobao 类型边及 React Flow。上述只是规格提出的借鉴方向，未将其许可/功能声明当作本机核验结果；本包不复制代码，不新增外部依赖。需要复用时重新核验具体版本 LICENSE 和子目录归属。

兼容成本：旧 AI 卡外键不可空，以人工附表续写统一历史，详见 ADR-005；单独 Director/Style 表、真实模型 capability 和资产引用待对应模块，当前编译必须冻结现有项目字段并如实报告缺口。保留旧 API URL，新接口与 UI 增量加入。两份规格中的 prompt/prompts、entity 表名、状态名只是建议，以实际模块合同为准。
