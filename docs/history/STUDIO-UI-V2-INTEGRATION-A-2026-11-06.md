# Studio UI V2 接入 A 验收

在 `redesign/studio-ui-v2` 上验证。浏览器测试使用独立 SQLite 与媒体目录。工作流和生成使用本地 Mock ComfyUI，媒体导入与探测使用测试文件和 FFmpeg。用户的 ComfyUI、模型、数据库与媒体目录无需参与本次验证。

| 检查 | 结果 |
|---|---|
| `npm run typecheck`、`npm run build`、`npm run format:check` | 通过 |
| `npm test` | 216 项通过 |
| `npx playwright test` | 1 项通过，覆盖初始化、直接进入空画布、素材、设置冲突、回收站与登录 |
| `npx playwright test --config playwright.boards.config.ts` | 8 项通过，覆盖搜索、恢复与跨项目链接回退、固定引用、版本冲突、只读权限、多画布与任务恢复 |
| `npx playwright test --config playwright.workflows.config.ts` | 11 项通过，覆盖提示词修订、工作流配置、试跑、发布、自动和手动调度 |
| 设计评审浏览器套件 | 3 项通过，复用本机已启动的 5196 评审服务 |

桌面项目列表、手机项目列表和两种尺寸的画布截图分别输出至本地 `test-results/studio-live-gallery-desktop.png`、`studio-live-gallery-mobile.png`、`boards-desktop.png`、`boards-mobile.png`。

画布恢复遵循当前用户的工作区与项目上下文。无封面项目采用占位图。生成、工作流与提示词库使用已验证的执行面板和窗口，生成面板的视觉迁移进入下一包。
