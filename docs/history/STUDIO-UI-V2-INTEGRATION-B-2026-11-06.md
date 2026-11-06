# Studio UI V2 接入 B 验收

在 `redesign/studio-ui-v2` 验证。采用独立 SQLite、测试媒体、FFmpeg 和 Mock ComfyUI。此轮为前端接入，没有数据库迁移或后端接口改动。

| 检查 | 结果 |
|---|---|
| 类型、构建、格式 | 通过 |
| API 回归 | 216 项通过 |
| 项目入口浏览器 | 1 项通过 |
| 正式画布浏览器 | 8 项通过。确认首帧移除后禁用生成，可重新绑定原图。Seed 随任务保存，断线重放只创建一个任务。手机展开参数并滚动时提交按钮仍可见，候选视频能读取尺寸。 |
| 工作流与提示词浏览器 | 11 项通过 |

运行画布套件后，在 `test-results/` 查看 `canvas-creation-light.png`、`canvas-creation-dark.png` 和 `board-execution-mobile.png`。真实模型和用户设备未参与。任务取消、远端核对和重试继续从任务窗口进入，工作流中心和提示词库管理页进入下一包。
