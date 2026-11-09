# Pullet Studio 文档导航

更新：2026-11-09。最高产品基线为[最终产品与工程执行合同](PRODUCT-EXECUTION-CONTRACT.md)，冲突处覆盖旧规划。现有产品 V2、资产方案和有效 ADR 保留兼容背景。先读[实时状态](IMPLEMENTATION-STATUS.md)中的当前阶段，再进入业务工作包；[DX OS 参考取舍](architecture/DXOS-REFERENCE-REVIEW.md)不引入第三方产物或替换技术栈。

## 先读哪几份

| 要解决的问题 | 唯一入口 | 用法 |
|---|---|---|
| 现在能做什么、缺什么、下一步是什么 | [IMPLEMENTATION-STATUS](IMPLEMENTATION-STATUS.md) | 唯一实时状态与实施顺序；不把历史测试数当最新结果 |
| 当前界面与验收资料 | [正式 UI 评审包](review/studio-ui-v2/README.md) | 正式接口截图、尺寸/主题/实际缩放、异常与权限证据；Mock 模型与真实媒体处理分别说明 |
| 产品最终范围、长期需求 | [正式执行合同](PRODUCT-EXECUTION-CONTRACT.md) | Web 创作空间、正式 UI 收敛、资产/画布/工作流/生成/复用；旧 V2、MASTER-PLAN 与团队蓝图冲突处由该合同覆盖 |
| 为什么这样设计 | ADR-001至012，先看[删除旧UI与多画布ADR-012](ADR-012-remove-retired-creation-ui.md)、[轻量创作ADR-011](ADR-011-asset-led-creation.md) | 旧强制生产前置由V2覆盖，旧UI保留决定由ADR-012覆盖 |
| 本地怎样运行、测试、备份 | [开发运行手册](operations/DEVELOPMENT.md) | 当前有效命令；完整媒体恢复转[LOCAL-MEDIA](LOCAL-MEDIA.md) |
| 体验包在哪、如何启动和停止 | [Windows 本机体验包](operations/LOCAL-PREVIEW.md) | 双击启动/停止、首次账号、包内数据及日志；[B11 合同](modules/LOCAL-PREVIEW-B11.md) |
| 代码/数据/文档各在哪里 | [工程目录与整理规则](architecture/REPOSITORY-MAP.md) | 当前模块映射、保留和渐进拆分规则 |
| 历次到底测了什么 | [阶段验收历史](history/IMPLEMENTATION-2026-11-04-05.md) | 保存原实施合同、迁移前后备份、实机证据；历史“下一包”不驱动开发 |

阅读优先级：用户当前决定 → AGENTS/有效ADR → 实时状态及本阶段合同 → 产品/技术基线 → 使用指南 → 历史参考。发现冲突先记录在实时状态，不能用旧文覆盖现有代码。

## 模块使用与合同

| 领域 | 使用/API与限制 | 开工合同及代码入口 |
|---|---|---|
| 全局设置 / ComfyUI / API | [左侧导航、右侧配置及权限](WORKFLOW-CENTER.md) | [B13 合同](modules/WORKSPACE-SETTINGS-B13.md)；实例在工作区共用，工作流保留项目归属；覆盖 B12 旧入口 |
| 节点就地操作与右键创建 | [就地操作](CREATIVE-CANVAS.md#就地操作) | [B14 合同](modules/CANVAS-INLINE-B14.md)；直接编辑文字、主动打开素材详情、节点删除与原件保留 |
| 当前自由创作 | [无镜头生成与候选入库](LIGHT-CREATION.md) | [L1 合同](modules/LIGHT-CREATION-L1.md)、[B5 引擎与类型](modules/GENERATION-TYPE-SELECTOR-B5.md)、[验收](history/LIGHT-CREATION-L1-2026-11-06.md)；共用Generation/Storage/RBAC |
| 项目资产/多画布的当前差异与下一包 | [依赖路线](architecture/ASSET-CANVAS-IMPLEMENTATION.md) | 提示词库与单节点执行已接通，接下来做统一授权和多模态 |
| 项目提示词库 | [保存、修订与复用](PROMPT-LIBRARY.md) | [L2-B合同](modules/PROMPT-LIBRARY-L2B.md)、[验收](history/PROMPT-LIBRARY-L2B-2026-11-06.md)；普通文本，共用Generation/Board |
| 媒体和语义资产 | [Local媒体/恢复](LOCAL-MEDIA.md)、[视频提帧](CREATIVE-CANVAS.md#从视频提取参考图)、[语义资产](SEMANTIC-ASSETS.md) | [B10 拖动提帧](modules/VIDEO-FRAME-EXTRACTION-B10.md)、[媒体合同](modules/LOCAL-MEDIA-IMPLEMENTATION.md)、[资产合同](modules/SEMANTIC-ASSETS-IMPLEMENTATION.md)、[资产审批合同](modules/ASSET-APPROVAL-IMPLEMENTATION.md) |
| ComfyUI生成 | [配置与运行](COMFYUI-GENERATION.md) | [生成](modules/COMFY-GENERATION-IMPLEMENTATION.md)、[首帧I2V](modules/COMFY-I2V-IMPLEMENTATION.md)、[参数](modules/WORKFLOW-PARAMETERS-IMPLEMENTATION.md)合同 |
| 工作流中心 | [技术图、修订、创作参数、试跑与发布](WORKFLOW-CENTER.md)、[四类能力对照](architecture/HERO-INFINITE-CANVAS-REVIEW.md) | [A1 合同](modules/WORKFLOW-CENTER-G2-A1.md)、[A2 合同](modules/WORKFLOW-CENTER-G2-A2.md)、[A3 合同](modules/WORKFLOW-CENTER-G2-A3.md)、[A3 验收](history/WORKFLOW-CENTER-G2-A3-2026-11-06.md) |
| 多模态工作流 | [工作流中心](WORKFLOW-CENTER.md)、[B1 原始评审](review/workflow-media-contract/README.md) | [B3 输入合同](modules/BOARD-IMAGE-INPUTS-B3.md)；[B4 可选参考与音频输出](modules/WORKFLOW-OPTIONAL-MEDIA-AUDIO-B4.md)；[B6 扩展产物](modules/GENERATION-OUTPUTS-B6.md)；[B7 批量主结果](modules/GENERATION-PRIMARY-BATCH-B7.md)；支持必填/可选媒体、单份/批量主结果及已声明扩展产物的归档、选择和复用 |
| 历史数据依赖 | [制作结构](PRODUCTION-STRUCTURE.md)、[原文导入](SCRIPT-IMPORT.md)、[文本分析](TEXT-ANALYSIS.md)、[草案审核](PROPOSAL-REVIEW.md)、[旧提示词](TEXT-DELIVERY.md) | 仅后台/历史合同；对应前端已删除，不作为当前功能开发入口 |
| Take历史与来源 | [Take审核合同](modules/TAKE-REVIEW-IMPLEMENTATION.md) | 旧前端已删除；媒体/任务/导出引用依赖继续受保护 |
| 原件打包与历史后期交付 | [原件包及素材包](MEDIA-PACKAGES.md) | [B9 单任务批量处理](modules/GENERATION-OUTPUT-BATCH-B9.md)、[原素材包合同](modules/MEDIA-PACKAGE-IMPLEMENTATION.md)、[历史标准交接](modules/DELIVERY-HANDOFF-IMPLEMENTATION.md)；复用媒体权限及流式 ZIP |
| 历史轻量预演 | [ANIMATICS](ANIMATICS.md) | 前端已删除；API/旧归档数据及媒体处理依赖保留 |
| 创作画布 | [直接导入、浮动生成与结果复用](CREATIVE-CANVAS.md) | [直接导入合同](modules/CANVAS-DIRECT-IMPORT.md)、[体验改版合同](modules/BOARD-CREATION-UX.md)、[L2-C 合同](modules/BOARD-EXECUTION-L2C.md)、[B8 同批次产物对照](modules/GENERATION-OUTPUT-COMPARISON-B8.md) |
| 资源库与公共素材 | [画布资源库使用](CREATIVE-CANVAS.md) | [项目分类与宽度](modules/PROJECT-LIBRARY-ORGANIZATION.md)、[工作区公共媒体库](modules/WORKSPACE-MEDIA-LIBRARY.md)、[公共角色/场景/道具](modules/PUBLIC-ENTITY-LIBRARY.md)；主动归档与独立项目导入，指定项目/用户的可撤销共享后续实施 |
| UI 重建分支 | [重建审计与阶段门禁](modules/STUDIO-UI-V2.md)、[设计规范](modules/STUDIO-DESIGN-SYSTEM.md)、[接入 A](modules/STUDIO-UI-V2-INTEGRATION-A.md)、[接入 B](modules/STUDIO-UI-V2-INTEGRATION-B.md)、[接入 C](modules/STUDIO-UI-V2-INTEGRATION-C.md) | 项目、画布、生成面板、工作流中心与提示词库已接真实接口。评审原型使用隔离示例数据 |

## 技术规格与参考

- [团队技术蓝图](architecture/TEAM-V1-TECHNICAL-BLUEPRINT.md)、[仓库续开发规格](architecture/REPOSITORY-CONTINUATION-PLAN.md)：长期模块需求，已同步新产品边界；建议表名/API不替代实际schema/Controller。
- [最初差异审计](architecture/TEAM-V1-GAP-AUDIT.md)：9c0ad77时期的快照，不能用于判断当前功能是否存在。
- [参考项目](06-REFERENCES.md)：定向学习、许可核验和采用边界，不是安装或Fork指令。
- [根CHANGELOG](../CHANGELOG.md)：面向使用者的变更；条目中的数字属于当时阶段，最新数字只见实时状态。

## 历史归档规则

[archive/2026-11-05](archive/2026-11-05/README.md)保留原01–05号设计、路线和开发记录，旧路径改为兼容入口。`history/`保存实施证据，`modules/`保存每阶段合同；两者不作为并行排期来源。稳定的MASTER/STATUS/ADR/使用指南路径保留，避免无收益的批量改链接。

每阶段只更新：实施状态中的当前结果/下一门禁、本阶段使用指南和必要ADR/合同；详细过程追加到history，避免再次把实时状态扩张成长日志。
