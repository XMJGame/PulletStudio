# L2-A 旧界面删除与多画布验收

2026-11-06，基于 8434529，执行 [ADR-012](../ADR-012-remove-retired-creation-ui.md) 与 [合同](../modules/CREATION-CLEANUP-L2A.md)。本轮没有后端 schema、迁移或授权范围变化，也没有调用真实 GPU、下载模型或改 ComfyUI。

## 实际改动

- 删除 47 个过时文件，不复制到保留目录；主页面去掉兼容菜单、分集/镜头状态与请求。
- 通用生成、媒体和试跑表单删除旧镜头分支；删除旧 API 前端类型及 75 条旧样式规则。
- 删除 G0 的 HTML、DOM/Flow 双实现、样例存储代码、独立浏览器测试、npm 脚本与 CI 入口。构建只剩正式应用，Vite 转换模块从 L1 的 121 到 92，不是运行时性能或帧率结论。
- 多画布切换/新建/独立历史，按用户和项目记住上次打开，权限仍由 API 校验。未保存草稿切换需要明确处理；项目资源不复制到各画布。
- 原型/旧编辑流程的浏览器 helper 删除；重写主入口验收，原参数/实例场景改用通用生成，原镜头试跑改直接文本。历史引用通过填充 Board 的真实读取测试继续验证。

## 测试证据

| 检查 | 实际结果 |
|---|---|
| npm test | 203/203，历史引用/不可变媒体/任务/权限/迁移与导出仍受保护 |
| npm run test:workflow-graph | 4/4 |
| 工作流浏览器 | 9/9；单输入/Schema/版本/权限/直接试跑/发布/实例调度 |
| 正式画布浏览器 | 5/5；历史 Shot 固定引用仍可读，冲突/撤权/交互；三画布共享同一角色，单首帧 I2V 在窗口关闭后完成并入库/复用 |
| 主入口浏览器 | 1/1；初始化/编号/无旧入口与查询、实际上传预览、设置冲突、回收站版本冲突/恢复、再次登录 |
| 类型/构建/格式 | 通过；没有新增依赖；G0 不再产生 HTML/JS 包 |

测试全部使用隔离数据库、合成媒体和 Mock。I2V 结果经过真实 FFprobe，不能据此宣称用户 H3 的新链路或 R2V 已实机通过。项目提示词库、ResourceAccess 共享、命名多模态端口仍未实施。

已核对 package/scripts/tools/CI，没有实际引用旧 Compose；删除 infra/compose.dev.yml，不移动至 legacy 或保留一份。

## 删除清单

- apps/web/canvas-lab.html
- apps/web/src/analysis-types.ts
- apps/web/src/canvas-lab/DomEngine.tsx
- apps/web/src/canvas-lab/FlowEngine.tsx
- apps/web/src/canvas-lab/NodeCard.tsx
- apps/web/src/canvas-lab/engine-types.ts
- apps/web/src/canvas-lab/main.tsx
- apps/web/src/canvas-lab/model.ts
- apps/web/src/canvas-lab/style.css
- apps/web/src/canvas/ShotTakeCompareDialog.tsx
- apps/web/src/components/AnalysisWorkbench.tsx
- apps/web/src/components/AnimaticDialog.tsx
- apps/web/src/components/AssetBindingsDialog.tsx
- apps/web/src/components/CandidateEditorDialog.tsx
- apps/web/src/components/FullCardEditorDialog.tsx
- apps/web/src/components/MediaPackageDialog.tsx
- apps/web/src/components/PromptDialog.tsx
- apps/web/src/components/ProposalReviewPanel.tsx
- apps/web/src/components/ReviewDecisionDialog.tsx
- apps/web/src/components/ScriptImportDialog.tsx
- apps/web/src/components/ScriptSourceDialog.tsx
- apps/web/src/components/ScriptWorkbench.tsx
- apps/web/src/components/ShotCardDialog.tsx
- apps/web/src/components/ShotDraftDetails.tsx
- apps/web/src/components/ShotEditor.tsx
- apps/web/src/components/StoryboardExportDialog.tsx
- apps/web/src/components/StructureWorkbench.tsx
- apps/web/src/components/TakeReviewPanel.tsx
- apps/web/src/components/TextConnectionsDialog.tsx
- apps/web/src/components/UnitDialog.tsx
- apps/web/src/prompt-types.ts
- playwright.canvas.config.ts
- tests/canvas/canvas.spec.ts
- tests/e2e/animatic-flow.ts
- tests/e2e/entities-flow.ts
- tests/e2e/generation-flow.ts
- tests/e2e/legacy-navigation.ts
- tests/e2e/media-flow.ts
- tests/e2e/media-package-flow.ts
- tests/e2e/production-structure-flow.ts
- tests/e2e/proposal-review-flow.ts
- tests/e2e/script-import-flow.ts
- tests/e2e/storyboard-export-flow.ts
- tests/e2e/take-review-flow.ts
- tests/e2e/text-analysis-flow.ts
- tests/e2e/text-delivery-flow.ts

- infra/compose.dev.yml

同路径 tests/e2e/studio.spec.ts 已重写为新主入口场景，故不在删除文件列表内。API 服务/历史迁移未删；保留真实被 Board、Job、媒体和导出引用的依赖不等于保留旧前端产品。
