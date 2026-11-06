# 工程目录与整理规则

> 2026-11-06 后续决定：[ADR-012](../ADR-012-remove-retired-creation-ui.md) 已删除 G0、旧创作/镜头/编译/预演 UI 及兼容菜单，覆盖下文对应保留建议。历史固定引用与后台依赖保留；[多画布与后续顺序](ASSET-CANVAS-IMPLEMENTATION.md) 以实施状态为准。

2026-11-06 当前入口：`main.tsx` 按项目选择呈现 `features/projects/StudioProjectGallery` 或 `canvas/BoardWorkspace` 普通主视图，旧 `CreationWorkspace` 已删除。`GenerationDialog` 保留项目通用生成/试跑；API 复用 `generation/`、`assets/` 和同一队列。API `prompt-library/` 与 Web `prompts/` 管理普通文本库，独立于旧 `prompt/` 编译器。原 `scripts/analysis/prompt/timeline` 保留后台历史依赖，G0 与旧创作 UI 已删除。不批量移动源码、运行数据或历史迁移；按实际职责提取，不增第二套 Generation/Storage。

审计：2026-11-05，整理时基线e828d8c为82个API源文件、43个Web源文件、18个API测试文件、13个E2E文件；统计不含node_modules/dist/data。G0随后增加独立canvas-lab及tests/canvas，详见下方增量。文件数量仅供定位，不作为持续进度指标。

## 保持的工程边界

```text
PulletStudio/
├─ apps/api/
│  ├─ src/
│  │  ├─ auth/ common/ config.ts       身份、请求保护、配置
│  │  ├─ production/ scripts/          项目、层级、完整卡、原文
│  │  ├─ providers/ analysis/          文本连接、分析任务、草案人工门禁
│  │  ├─ prompt/                       Profile、编译与固定Artifact
│  │  ├─ prompt-library/               项目普通文本库、不可变修订和来源校验
│  │  ├─ storage/ assets/              Local、媒体、语义资产、Take审核/选片
│  │  ├─ generation/                   ComfyUI/Job、工作流目录修订、字段Schema/依赖报告
│  │  ├─ timeline/                     已有可选轻量预演
│  │  ├─ exports/                      分镜与标准媒体交付
│  │  ├─ boards/                       G1正式Board、修订、固定引用及项目RBAC
│  │  ├─ db/                           实际schema、连接、备份/迁移执行
│  │  └─ *-worker.ts                   三个Worker的进程入口
│  ├─ drizzle/                        已应用的SQL、快照和journal，顺序不可改
│  └─ test/                           按业务拆分的隔离Node集成测试
├─ apps/web/src/
│  ├─ main.tsx / style.css             应用入口、身份与当前表单样式
│  ├─ shared/styles/ / shared/ui/      共享主题令牌、Dialog主题与基础控件
│  ├─ features/projects/              正式项目首页与浏览器偏好
│  ├─ features/canvas/                画布视觉组件、正式生成面板样式
│  ├─ design-review/                  隔离评审入口和示例素材
│  ├─ components/                     素材、任务、项目与团队表单及Dialog
│  ├─ prompts/                        共用项目提示词库窗口与类型
│  ├─ canvas/                         G1正式React Flow/来源/Inspector/冲突/历史，懒加载
│  ├─ workflows/                      中心/历史/报告、共享配置、只读图、公开字段编辑/创作者表单
│  └─ *-types.ts / api.ts              前端类型与HTTP调用
├─ packages/contracts/                Storage接口已使用；通用Provider接口仍是草案
├─ tests/e2e/ / tests/fixtures/        浏览器业务flow、Mock及合成媒体工具
├─ tests/boards/                      G1真实隔离API/媒体验收，playwright.boards.config.ts
├─ tests/workflows/                   解析/边界单测与中心浏览器验收，复用隔离启动配置
├─ tools/                             setup、API监视启动、媒体校验
├─ examples/                          通用绑定样例，无本机连接配置
├─ docs/                              当前基线、决策、使用指南及下列分类
│  ├─ architecture/                   技术规格、初始审计、代码映射
│  ├─ modules/                        实施前合同及验收边界
│  ├─ operations/                     当前有效运行/验证/恢复
│  ├─ history/                        历次验收与迁移证据
│  └─ archive/                        已替代的设计/路线；旧路径保留入口
└─ data/ / test-results/ / node_modules/ / dist/  本机运行或生成内容，不入Git
```

没有独立apps/worker、provider-sdk或storage-sdk应用，旧技术图中的同名目录属于建议。Provider实际实现为providers/text-provider与generation/comfy-provider，LocalStorage实现contracts/storage-port；可插拔边界保留，但不能把草案类型当成已交付多Provider/S3。

G2-A2在generation/追加workflow-catalog.service/controller/state管理原不可变定义的目录关联，workflow-fields负责标量合同，workflow-inspection负责有界声明诊断。仅新增0035的两张关联表；不拆迁旧定义/Job，不新建队列。packages/contracts/src/workflow.d.ts共享Web字段声明，API以Zod为运行校验事实。模块合同/使用/验收分别放modules/、根指南和history/。

当前正式入口为 `apps/web/index.html`，项目直接进入普通 Board 主视图，与项目首页互斥挂载。`canvas/BoardMediaFrame` 负责媒体画面与按需单节点播放；`BoardWorkspace` 继续管理保存与执行。隔离评审入口 `studio-review.html` 及 `features/canvas/StudioCanvas*`、`StudioComposer`、`studio-canvas*` 冻结为历史设计样例，示例资源位于 `design-review/`，不继续维护第二套生产画布。正式浏览器套件位于 `tests/e2e/`、`tests/boards/`、`tests/workflows/`，评审套件只记录历史设计。源码按实际职责渐进提取，不为目录整齐搬移业务或数据。

`canvas/useBoardSources` 管理资源查询、分页与过期响应隔离，`BoardSources` 只处理展示和筛选。`prompts/PromptLibraryPicker` 负责就地选用固定版本，`PromptLibraryDialog` 保留编辑管理，两者共用原 Prompt Library API 与类型；固定应用逻辑在 BoardWorkspace 复用。`tests/fixtures/browser-zoom.mjs` 仅在独立测试配置目录创建临时扩展和浏览器，用于实际页面缩放，不进入产品构建。

`canvas/BoardCandidates` 管理候选主预览、历史选择及双结果对照；执行、任务读取与入库由 `BoardExecutionPanel` 沿用原接口。`canvas/BoardSourcePreview` 负责资源库中的固定版本预览与错误清理，不创建新的媒体记录。两个组件都属于正式 Board，不接入冻结的评审原型。

`canvas/BoardEntityVersions` 在正式资源预览中读取原实体历史，处理分页、重试与过期响应；`BoardSourcePreview` 固定所选修订、查看其参考媒体并显式加入画布。它们复用既有实体/引用解析接口，不是第二套资产库，也不扩展多参考执行合同。

`docs/review/studio-ui-v2/` 只存可公开评审的正式页面截图、矩阵和来源清单，`tools/ui-review.mjs` 按白名单重新收集。完整尺寸与主题截图及隔离运行文件仍留在忽略的 `test-results/`。CI 只上传 PNG/错误摘要，不上传 profile、DB 或运行媒体。

## 本轮实际整理

1. 完成标准交付包并单独提交，业务与文档整理分开追溯。
2. docs/README作为导航；IMPLEMENTATION-STATUS只放当前覆盖、缺口、测试、依赖和下一门禁。
3. 原实施状态全文进入history，旧01–05进入archive并留下兼容链接；不删历史内容、不移动稳定MASTER/ADR/模块指南路径。
4. 根README更新运行与真实能力，运行细节集中到operations；根CHANGELOG记录阶段成果，不再作为现状总表。
5. 初始TEAM-V1-GAP-AUDIT明确标历史；规格正文的建议表名和旧技术示例不用于生成第二套数据模型。

## 源码暂不批量移动，按功能渐进整理

| 观察到的维护点 | 何时整理 | 边界与验证 |
|---|---|---|
| Web main.tsx仍集中管理身份与项目弹窗 | 对应职责再次扩展时 | 项目首页与画布视觉已移入features，共享主题和控件移入shared，旧中转页与布局样式已删。后续按稳定职责提取状态，沿用入口和冲突回归 |
| GenerationDialog约806行，MediaDialog/AnimaticDialog约590行 | 实际更改对应业务时 | 抽配置、任务、结果等职责，不为行数拆空壳；API合同不变 |
| API schema.ts约1272行 | 有确切新增领域需要时 | 暂保留统一schema，先保持migration连续性，不能拆目录时重建数据库 |
| MediaService约773行，ProductionService约627行 | 对应功能产生稳定子领域时 | 保留公共service/权限/事务边界，逐个迁出内部职责，使用已有集成测试 |
| 一条Playwright大场景串起各flow | 新模块需要独立验收时 | 增加可复用隔离fixture与独立场景；原全链路保留，避免所有UI调试都重走初始化 |
| 通用Provider草案与实际运行合同不同 | 接第二Provider时 | 先对齐消费方/能力声明，不提前把所有服务迁到新SDK |

不移动或清理data、正式媒体、备份、密钥、已应用SQL、node_modules；不重装运行依赖。体积/保留期/安全GC另立数据生命周期任务。本轮没有删除运行文件或改变API路径，源码整理不能取代产品交付。
