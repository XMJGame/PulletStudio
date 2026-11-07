# B4 可选音视频与音频主输出

基线 8956c78。复用 B3 的工作流不可变修订、媒体权限、画布具名输入及 Generation/Worker/Storage，不新增队列。

## 修改范围与约束

- DB：工作流 capability 增加 TypeScript 枚举 `audio.music`，SQLite 原列无需重建。增量迁移仅增加旧 Worker 领取保护；生成前在线备份。新快照记录可选音视频/音频输出标记，旧快照保持可读。
- API：工作流保存、依赖检查与 Worker 共用类型检查。可选参考媒体限专用 `LoadImage.image`、`LoadVideo.file`、`LoadAudio.audio`，只取输出 0、无其他配置或输出声明。所有下游必须显式可选且类型一致；支持 min=0 的同类型 Autogrow。必填解码/转换链不自动剪除，不把空文件名提交给实例。保存时与执行前均检查 `/object_info`。
- 音频：先接 `audio.music`，支持单一正式主输出，通过已配置的 history 字段读取原文件。沿用现有 WAV/MP3/OGG/Opus/M4A/WebM 探测与原件归档；不承诺 FLAC、多个输出或自动转码。音频只从项目/画布/试跑入口创建，旧 Shot/Take 接口不扩张。扩展输出声明仍不可执行。
- Worker：空槽只修改提交副本，移除可省略的下游输入和专用加载器；固定原图与快照不变。音频结果以实际内容探测，伪装图片/视频拒绝。保留权限重查、响应不明恢复、去重与候选/试跑隔离。
- UI：工作流编辑器开放参考视频/音频的断开选项，新增音频生成方式；画布、自由生成及试跑按同一 Schema 展示可选槽位。候选用音频控件播放，可入库、下载、成为固定结果节点和后续输入。沿用现有布局和主题。

## 故障与验收

未知加载器、共享节点、额外配置、非零输出、必填或错类型下游拒绝。实例声明变化后不得上传或提交；权限收回、输入损坏、错误结果、试跑隔离及重试走原错误路径。测试使用独立数据库和真实测试媒体字节，Mock 模型；不下载模型、不调用真实 GPU。

验证 API 的空/单/全选音视频、固定快照、任务重放、旧 Worker 拒绝、错误输出、音频候选入库与试跑。浏览器覆盖可选控件、音频播放/固定节点/复用及桌面手机可达性。最终证据与剩余限制写 IMPLEMENTATION-STATUS。

## 上游依据

已核对 ComfyUI 原生 [LoadAudio](https://github.com/comfyanonymous/ComfyUI/blob/master/comfy_extras/nodes_audio.py) 与 [LoadVideo](https://github.com/comfyanonymous/ComfyUI/blob/master/comfy_extras/nodes_video.py) 的单文件输入和输出类型；每台实例仍以实际 object_info 为准。用户提供的 MiniMax Music3 API JSON 使用 SaveAudioAdvanced、MP3 主输出；本包独立通用实现，不绑定该模型。

## 验收证据

本地 API 267、画布 30、工作流浏览器 17、图解析 4 项通过，构建/类型/格式通过。浏览器实际播放 MP3、复用为后续音频输入并检查桌面/390px 手机截图。媒体上传使用真实测试字节，模型使用 Mock；未进行真实 GPU、MiniMax Music3 权重或 ModelScope 账号验收。

生成前备份为 data/backups/studio-2026-11-07T01-57-41-753Z-debb3978.sqlite。隔离副本 42→51 条迁移，55 张旧表内容与迁移前缀一致、integrity_check=ok、外键错误为零。正式库只读复核仍为 42 条迁移。日志为忽略目录 data/e2e/b4-api-full.log、b4-board-full.log、b4-workflow-full.log 及 b4-migration-check.json。
