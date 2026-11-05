# 时间线与低清预演

项目制作结构的“时间线与预演”使用当前有效选片编排顺序。首版支持单轨图片/视频混剪，最多24片段、300秒，源原件合计最多2GiB。支持横屏640×360、竖屏360×640、方形480×480、经典640×480和宽银幕640×272。

1. 选择当前镜头、直属、制作单元或项目范围，按当前选片载入。载入会替换尚未保存的片段编辑。
2. 调整顺序、视频入点和时长、图片停留时长。实际有音轨且制作卡计划为inspect/replace时，明确选择本次预演保留原声或静音。静帧和无原声视频默认静音。
3. 预览时间线，核对实际起始位置和时长。内部使用整数毫秒，25fps预演按40ms向上对齐。视频保留源帧时钟，画面变化取下一个输出帧时刻。请求区间须在原件时长内，对齐不足一帧的尾部补齐末帧。
4. 保存新版本后生成预演。页面显示排队、渲染、归档、失败或完成状态，可取消执行中的任务。完成后可以播放和下载MP4。

新版本使用连续版本号和并发保护。源选片或制作卡变化后，重新载入并保存时间线。历史时间线可以查看固定片段和已归档预演。历史文件读取沿用当前项目和源媒体权限。

## Worker及归档

构建后在独立进程运行预演Worker。

```powershell
npm run build
npm run worker:animatic
```

同一数据库同时执行一个预演任务。队列、租约和结果持久保存，API或Worker重启后可以继续处理过期租约。取消运行任务时Worker检查到取消后停止子进程，检查周期5秒。单次渲染总超时15分钟，每个FFmpeg步骤也有限时和线程限制。

输入从受权存储流复制到独立临时目录，并比对固定哈希。片段统一画幅、帧率和声音格式后拼接，最终输出H.264/AAC MP4。完成前核对实际尺寸、帧数、时长和音轨，通过现有MediaService校验、归档和结果登记。预演原件来源为animatic，任务本身保留时间线和源选片依据。

归档后的登记失败会保留现场并重试，优先复用已登记原件。其他失败可明确再次生成，新旧任务分别保留。备份按LOCAL-MEDIA流程保留SQLite和完整媒体根，预演原件/封面与输入一起校验。

按2026-11-05产品边界（ADR-009），现有功能用于轻量故事板预演，不继续开发独立音轨编排、转场、关键帧、调色、特效或专业混音。声音素材及SRT交付另按实际来源推进。当前音频选片需要另行选择可用于画面轨的图片或视频；最终剪辑在外部软件完成。

## 接口

均在/api/v1下，读取要求项目read，保存与生成要求edit。写操作沿用CSRF保护，保存及排队使用UUID Idempotency-Key。

- POST /projects/:id/timeline-editor，正文为素材包相同的scope，返回选片、原件时长/声音信息、默认片段、sourceHash和当前版本。
- POST /projects/:id/timelines/preview，正文为scope、sourceHash、profile和clips。每个clip包含shotId、整数inMs/durationMs及audioPolicy（keep/mute），返回固定预览快照和snapshotHash。
- POST /projects/:id/timelines，在预览正文中增加expectedVersion及expectedPreviewHash，追加不可变版本。相同键的相同请求可重试，内容或基线变化返回409。
- GET /projects/:id/timelines?before=版本，每页20条；GET /timelines/:id读取完整固定快照。
- POST /timelines/:id/animatics，正文为空对象，排队生成；GET同一路径返回最近20条预演任务。
- POST /animatic-jobs/:id/cancel，正文为空对象，创建者或项目管理者可取消活动任务。
- 产物继续使用/media-versions/:id/content及poster，支持鉴权、Range和原件下载。预演任务上传由Worker管理，普通上传与手工恢复接口不能接管。
