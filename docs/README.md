# Pullet Studio 文档导航

更新：2026-11-06。当前主线见 [PRODUCT-V2](PRODUCT-V2.md)、[资产与多画布方案](PROJECT-ASSETS-AND-MULTICANVAS.md)与 [ADR-012](ADR-012-remove-retired-creation-ui.md)。旧创作 UI 与 G0 已删除；历史数据和后台依赖保留。先看当前状态再进入模块。

## 先读哪几份

| 要解决的问题 | 唯一入口 | 用法 |
|---|---|---|
| 现在能做什么、缺什么、下一步是什么 | [IMPLEMENTATION-STATUS](IMPLEMENTATION-STATUS.md) | 唯一实时状态与实施顺序；不把历史测试数当最新结果 |
| 产品最终范围、长期需求 | [PRODUCT-V2](PRODUCT-V2.md)、[V2审计](architecture/PRODUCT-V2-AUDIT.md) | 资产/画布优先；[MASTER-PLAN](MASTER-PLAN.md)及旧团队蓝图保留参考，冲突处由V2替代 |
| 为什么这样设计 | ADR-001至012，先看[删除旧UI与多画布ADR-012](ADR-012-remove-retired-creation-ui.md)、[轻量创作ADR-011](ADR-011-asset-led-creation.md) | 旧强制生产前置由V2覆盖，旧UI保留决定由ADR-012覆盖 |
| 本地怎样运行、测试、备份 | [开发运行手册](operations/DEVELOPMENT.md) | 当前有效命令；完整媒体恢复转[LOCAL-MEDIA](LOCAL-MEDIA.md) |
| 代码/数据/文档各在哪里 | [工程目录与整理规则](architecture/REPOSITORY-MAP.md) | 当前模块映射、保留和渐进拆分规则 |
| 历次到底测了什么 | [阶段验收历史](history/IMPLEMENTATION-2026-11-04-05.md) | 保存原实施合同、迁移前后备份、实机证据；历史“下一包”不驱动开发 |

阅读优先级：用户当前决定 → AGENTS/有效ADR → 实时状态及本阶段合同 → 产品/技术基线 → 使用指南 → 历史参考。发现冲突先记录在实时状态，不能用旧文覆盖现有代码。

## 模块使用与合同

| 领域 | 使用/API与限制 | 开工合同及代码入口 |
|---|---|---|
| 当前自由创作 | [无镜头生成与候选入库](LIGHT-CREATION.md) | [L1 合同](modules/LIGHT-CREATION-L1.md)、[验收](history/LIGHT-CREATION-L1-2026-11-06.md)；共用Generation/Storage/RBAC |
| 项目资产/多画布的当前差异与下一包 | [依赖路线](architecture/ASSET-CANVAS-IMPLEMENTATION.md) | 提示词库已接通；下一批执行端口→统一授权→多模态；原始建议不是已实现功能 |
| 项目提示词库 | [保存、修订与复用](PROMPT-LIBRARY.md) | [L2-B合同](modules/PROMPT-LIBRARY-L2B.md)、[验收](history/PROMPT-LIBRARY-L2B-2026-11-06.md)；普通文本，共用Generation/Board |
| 媒体和语义资产 | [Local媒体/恢复](LOCAL-MEDIA.md)、[语义资产](SEMANTIC-ASSETS.md) | [媒体合同](modules/LOCAL-MEDIA-IMPLEMENTATION.md)、[资产合同](modules/SEMANTIC-ASSETS-IMPLEMENTATION.md)、[资产审批合同](modules/ASSET-APPROVAL-IMPLEMENTATION.md) |
| ComfyUI生成 | [配置与运行](COMFYUI-GENERATION.md) | [生成](modules/COMFY-GENERATION-IMPLEMENTATION.md)、[首帧I2V](modules/COMFY-I2V-IMPLEMENTATION.md)、[参数](modules/WORKFLOW-PARAMETERS-IMPLEMENTATION.md)合同 |
| 工作流中心 | [技术图、修订、创作参数、试跑与发布](WORKFLOW-CENTER.md)、[四类能力对照](architecture/HERO-INFINITE-CANVAS-REVIEW.md) | [A1 合同](modules/WORKFLOW-CENTER-G2-A1.md)、[A2 合同](modules/WORKFLOW-CENTER-G2-A2.md)、[A3 合同](modules/WORKFLOW-CENTER-G2-A3.md)、[A3 验收](history/WORKFLOW-CENTER-G2-A3-2026-11-06.md) |
| 历史数据依赖 | [制作结构](PRODUCTION-STRUCTURE.md)、[原文导入](SCRIPT-IMPORT.md)、[文本分析](TEXT-ANALYSIS.md)、[草案审核](PROPOSAL-REVIEW.md)、[旧提示词](TEXT-DELIVERY.md) | 仅后台/历史合同；对应前端已删除，不作为当前功能开发入口 |
| Take历史与来源 | [Take审核合同](modules/TAKE-REVIEW-IMPLEMENTATION.md) | 旧前端已删除；媒体/任务/导出引用依赖继续受保护 |
| 标准后期交付 | [素材包](MEDIA-PACKAGES.md) | [原素材包合同](modules/MEDIA-PACKAGE-IMPLEMENTATION.md)、[标准交接合同](modules/DELIVERY-HANDOFF-IMPLEMENTATION.md)；API exports/ |
| 历史轻量预演 | [ANIMATICS](ANIMATICS.md) | 前端已删除；API/旧归档数据及媒体处理依赖保留 |
| 创作画布 | [多画布与固定引用](CREATIVE-CANVAS.md) | [L2-A 合同](modules/CREATION-CLEANUP-L2A.md)、[验收](history/CREATION-CLEANUP-L2A-2026-11-06.md) |

## 技术规格与参考

- [团队技术蓝图](architecture/TEAM-V1-TECHNICAL-BLUEPRINT.md)、[仓库续开发规格](architecture/REPOSITORY-CONTINUATION-PLAN.md)：长期模块需求，已同步新产品边界；建议表名/API不替代实际schema/Controller。
- [最初差异审计](architecture/TEAM-V1-GAP-AUDIT.md)：9c0ad77时期的快照，不能用于判断当前功能是否存在。
- [参考项目](06-REFERENCES.md)：定向学习、许可核验和采用边界，不是安装或Fork指令。
- [根CHANGELOG](../CHANGELOG.md)：面向使用者的变更；条目中的数字属于当时阶段，最新数字只见实时状态。

## 历史归档规则

[archive/2026-11-05](archive/2026-11-05/README.md)保留原01–05号设计、路线和开发记录，旧路径改为兼容入口。`history/`保存实施证据，`modules/`保存每阶段合同；两者不作为并行排期来源。稳定的MASTER/STATUS/ADR/使用指南路径保留，避免无收益的批量改链接。

每阶段只更新：实施状态中的当前结果/下一门禁、本阶段使用指南和必要ADR/合同；详细过程追加到history，避免再次把实时状态扩张成长日志。
