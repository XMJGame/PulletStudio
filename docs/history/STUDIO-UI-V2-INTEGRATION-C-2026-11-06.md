# Studio UI V2 接入 C 验收

工作流中心与提示词库采用统一浅深色及桌面双栏。移动端切换列表和内容时保持工作流 JSON、绑定和提示词版本。测试使用独立 SQLite、测试媒体和 Mock ComfyUI。

| 检查 | 结果 |
|---|---|
| 类型、构建、格式 | 通过 |
| API 回归 | 216 项通过 |
| 工作流与提示词浏览器 | 11 项通过，覆盖导入、节点映射、受限数据、修订、草稿冲突、手机切换、提示词复用、试跑、发布与调度 |
| 正式画布和项目入口浏览器 | 9 项通过 |

节点图并排显示后的 4 项相关浏览器用例再次通过。查看节点及选择输入字段不会标记配置为已修改，明确设置映射仍触发草稿保护。浅色悬停按钮和深色图已检查。

浏览器截图输出到本地 `test-results/`，包括 `workflow-center-desktop.png`、`workflow-center-dark.png`、`workflow-center-mobile.png`、`prompt-library-desktop.png`、`prompt-library-mobile.png`。
