# API 平台快捷接入

## 第一阶段 · 免费额度平台的文本连接

- 在工作区和画布的操作菜单增加「API 设置」。先提供 ModelScope 中国站和 Agnes AI 国际站的文本模型预设，沿用已有文本模型处理服务。页面区分已保存、未启用与缺少密钥，保存只表示本地配置成功。额度与活动适用条件以平台账号为准。
- 复用 `TextController`、`TextConnectionsService`、`ProviderSecrets` 和工作区权限。现有 GET/POST `/workspaces/:id/text-connections` 读取与创建，PATCH `/text-connections/:id` 用版本号保护密钥轮换和启停。不改数据库、Generation Worker 或旧接口。实例管理员且可管理工作区时可以创建，工作区管理员可维护已有连接。表单失败保留输入。明文密钥仅提交给服务端。
- 验收两套预设保存、重新打开后状态、凭据不回显、启停及权限。使用隔离数据库和测试密钥，不请求云端推理或消耗额度。

## 第二阶段 · 画布 API 生成

先接 ModelScope 文生图。复用 Generation 任务与媒体归档，适配异步提交、轮询、限流、任务恢复及产物下载。Agnes AI 图片随后接入，视频按单独异步协议做，试用状态标注为限时或账号额度。首版按模型明确列出可执行能力。只有打通了实际入口与归档的能力才允许提交。音频使用另一个明确支持音频的 Provider 或 ComfyUI 工作流。保留 FHL、APIMart、RunningHub 等评估空间。

生成面板分开选择执行引擎（API / ComfyUI）和产物类型（图片 / 视频 / 音频），按交集筛选已配置模型或工作流。模型来源、绑定、最终参数与输入资产版本写入任务快照。切换引擎不复用另一协议专属参数。

ModelScope 首包的实施范围为工作区云端媒体凭据、项目固定模型配置、现有画布生成节点和既有任务归档。云端连接与 ComfyUI 实例池分离。增量迁移为连接标记 Provider，并阻止旧 Worker 领取云端任务。Worker 将服务商任务 ID 持久化，已接受的任务恢复轮询，提交不确定时停止自动重发。结果下载使用独立的受限公网 HTTPS 请求，不转发凭据。

真实预验收使用无项目素材的最小文生图请求，ModelScope 返回 HTTP 401，明确要求账号绑定阿里云，未创建任务。隔离 Provider 覆盖实际提交、轮询和归档入口，真实验收状态单独记录。

## 第三阶段 · 工作流映射体验与多模态

DX OS 本地只读资料显示，其工作流卡片使用节点 ID 与输入名定位字段，并用槽位关联媒体。原生界面嵌入还依赖安装在 ComfyUI 实例中的 Bridge。Pullet 继续使用工作流中心的简化技术图、参数配置、试跑、版本化发布。管理员选择公开字段、默认值、范围、单位和媒体槽位，创作面板按同一份固定工作流修订生成控件。API JSON 内部模型、路径、凭据等配置不作为创作参数。需要重连技术节点时直接在 ComfyUI 编辑并重新导入。

以用户提供的 MiniMax H3 R2V API JSON 为例，节点 115 的 `aspect_ratio` 与 `megapixels` 分别映射比例和目标像素量。图中 `0.4` 为目标 MP。该工作流的 16:9、32 像素对齐按 ComfyUI 实现算出约 864 × 480。时长、随机种子和媒体槽位分别映射各自节点的输入。先做参数预览的所见即所得，再分批验证可选媒体、视频和音频，空槽位处理必须匹配该工作流图结构。

### 可选参考与失败交互

- 用户提供的 R2V API JSON 已接两路 `LoadImage`，节点 136 以 `ref_images.ref_image_0`、`ref_images.ref_image_1` 引用；没有接参考视频或音频。图上有音频解码属于生成结果。上游 R2V 节点虽支持可选图片、视频帧和音频组，单个导入修订只暴露已配置的槽位。
- 当前 Pullet 的 `onMissing: empty` 仅是声明，执行会拦截。这份 R2V 图不适合用空字符串填 `LoadImage.image`。后续为能证明安全的可选绑定声明明确的断开目标。只在本次提交的图副本移除对应可选输入键，保留仍被其他路径引用的节点。无法证明安全的槽位保持必填或阻止运行。旧修订不改写。
- 创作面板可把提示词内的媒体引用做成槽位标签，以固定槽位 ID 表示。提交时按实际绑定和模板能力生成该模型认识的标记；例如 H3 用按实际引用排序的 `<Picture 1>`、`<Video 1>`、`<Audio 1>`。删除或替换素材后重新校验，避免把界面的 `@图片1` 当作模型通用语法。
- 先以自建小素材和隔离 Provider 验证一图、双图、可选断开、共享上游保留、必填拒绝、顺序与标签，以及错误回传。实机验收固定种子并更换或移除参考，核对实际输入与结果；生成文件存在只证明产物已返回。失败结果卡保留任务状态与重试入口，清楚显示失败阶段，错误细节在任务详情里查看。

补充参考：[MiniMax H3 原生节点](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py) · [官方 R2V 模板](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_r2v.json) · [ComfyUI 动态输入](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api/latest/_io.py)

官方参考：[ModelScope API-Inference](https://modelscope.cn/docs/model-service/API-Inference/intro) · [Agnes AI 模型计费](https://wiki.agnes-ai.com/en/docs/pricing) · [ComfyUI ResolutionSelector](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_resolution.py)
