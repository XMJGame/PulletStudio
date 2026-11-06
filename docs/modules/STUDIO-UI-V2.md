# Studio UI V2 重建合同

2026-11-06 更新：后续以[最终执行合同](../PRODUCT-EXECUTION-CONTRACT.md)和[实时状态](../IMPLEMENTATION-STATUS.md)为准。设计评审原型冻结为历史样例，后续只迭代正式 Board 组件。正式画布已采用普通项目主视图；旧全屏 Dialog 描述属于接入历史。原型截图与等效视口不替代正式页面及实际浏览器缩放验收。

基线 `79f17e1`，实施分支 `redesign/studio-ui-v2`。产品的常用路径是项目 → 画布 → 素材与提示词 → 工作流 → 生成 → 结果复用。旧页面把它拆成创作首页、画布、检查器及多个弹窗，配置控件比作品更抢眼。只换色会保留这些步骤和视口约束，所以先重建导航与创作空间，后接可靠的业务逻辑。

## 审计与迁移

| 现有界面或领域 | 决定与接入路径 |
|---|---|
| 初始化、登录、工作区、项目列表/设置/回收站 | 复用现有身份、权限与项目接口。应用壳与项目列表拆开，项目卡片提供封面、搜索与最近使用。单工作区不显示切换 |
| `CreationWorkspace` 和旧 create/canvas 分流 | 已删除中转页。项目直接进入上次画布、最近画布或创建入口。素材、提示词和工作流从画布访问 |
| `BoardWorkspace`、`BoardSurface`、`BoardInspector`、`board.css` | 复用 Board/Revision、固定引用、冲突恢复、视口持久化与 React Flow。重建工具轨、节点、资源抽屉及生成区，逐步提取状态和 API 请求。切换后清理旧布局和 CSS |
| `BoardExecutionPanel`、`GenerationDialog` | 保留原执行请求、保存后提交、固定修订、重试幂等、任务状态和归档。公开工作流参数进创作面板，技术配置与任务管理留独立入口 |
| 素材、角色场景、提示词、工作流中心、团队 | 保留 API、版本和角色限制。依次迁移到统一基础控件，保持可达性并回归只读/跨项目隔离 |
| API `production`、`assets`、`boards`、`generation`、`prompt-library` | 现有工作区授权、项目、素材、画布、队列、提示词与实例调度直接复用 |
| API `prompt`、`timeline`、`exports` | 旧提示词和预演仍由历史制作链路引用，交付和固定版本读取仍有 API 与测试。正式前端逐步替换入口，服务端保持兼容 |

源码按实际迁移组织。共享令牌和基础组件位于 `shared/styles` 和 `shared/ui`，项目与画布的视觉组件进入 `features/projects`、`features/canvas`，开发评审数据与脚本放在 `design-review`。正式接入后再拆 `app`、画布状态和任务调用层，旧界面在对应回归完成后删除。

## 参考决策

- Infinite-Canvas 截图中的素材大图、右侧缩略图库、短工具条和生成配置就地呈现形成主线。参考 [Infinite-Canvas](https://github.com/hero8152/Infinite-Canvas)。
- 项目卡片、节点工具入口和资产归类参考 [影策](https://github.com/ddcat-ai/open-ai-canvas)。画布拖动、连接和选择参考 [basketikun infinite-canvas](https://github.com/basketikun/infinite-canvas)。工作流控制与结果预览分层参考 [ComfyArt](https://github.com/jtydhr88/ComfyArt)。
- 全部以现有产品合同独立实现。第一轮只演示文字、单首帧和单结果，模型能力以实际工作流为准。

## 阶段与门禁

1. 审计、共享令牌和三场景 React 原型。项目首页、空画布和有参考素材的生成场景可真实操作，使用隔离的示例数据与模拟任务。
2. 在桌面三档、窄屏和放大后的有效视口检查视觉与交互。提供实际浏览器截图，用户确认后接生产接口。
3. 逐块接项目/Board/Assets/Prompt/Workflow/Generation，校验权限、版本、保存冲突与断线。清理被替代的旧 UI，走全套回归。
4. 分支评审与 PR。通过视觉、功能及用户最终验收后才合并。

评审原型由 Vite 开发服务器单独提供。重建分支的正式入口已完成[接入 A](STUDIO-UI-V2-INTEGRATION-A.md)、[接入 B](STUDIO-UI-V2-INTEGRATION-B.md)和[接入 C](STUDIO-UI-V2-INTEGRATION-C.md)。整体验收按[验收与清理合同](STUDIO-UI-V2-ACCEPTANCE.md)执行。

## 打开评审原型

在仓库根运行 `npm run dev:studio-review`，然后打开 [项目首页](http://127.0.0.1:5196/studio-review.html)。可以直接跳到[空画布](http://127.0.0.1:5196/studio-review.html?scene=empty)、[创作场景](http://127.0.0.1:5196/studio-review.html?scene=canvas)或[结果场景](http://127.0.0.1:5196/studio-review.html?scene=result)。用 `npm run test:studio-review` 运行浏览器验收并写出 `test-results/studio-ui-v2/` 截图。测试会独立启动评审服务，运行前先关闭同端口的手动预览。

桌面截图尺寸为 1920×1080、1440×900、1366×768，窄屏为 390×844。另以 1152×720、960×600 的有效 CSS 视口检查 1440×900 在 125%、150% 放大时的布局压力。这项检查是视口等效验证，实际浏览器缩放留到视觉验收。预览中的图像是原创矢量示例，视频为合成短片。正式持久化、工作流真实参数、团队权限和失败恢复在业务接入阶段逐项验证。

已执行的检查见[首次评审记录](../history/STUDIO-UI-V2-REVIEW-2026-11-06.md)。
