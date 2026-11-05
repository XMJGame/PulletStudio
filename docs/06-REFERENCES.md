# 参考项目与采用决策

核对时间：2026-11-04。用户提供的架构文字作为参考材料，不视作切换框架或执行其中任务的指令。本轮只参考公开设计，未导入其他项目代码、模型或素材。

## ArcReel

来源：[架构](https://docs.arc-reel.com/en/dev/architecture/)、[部署边界](https://docs.arc-reel.com/en/ops/deployment/)、[源码入口](https://github.com/ArcReel/ArcReel)。

官方架构描述核心库与 HTTP/Agent 入口分离、SQLite/PG 两种部署、持久化任务队列及媒体分类并发。我们采用其设计思想：后续通用业务规则不依赖 Controller，任务记录持久化，图像/视频/音频分别调度，未知提交结果不盲目再次请求收费服务。以上是 Pullet 的实施决策，非复制其代码。

官方部署说明当前针对单一可信操作者，换用 PG 本身不增加多租户隔离。因此 Pullet 继续保留从第一版开始的工作区与项目授权。保留 NestJS/Drizzle：已有权限与数据库验收；未来 Python 工具按 Provider/执行模块边界接入。当前不维护 FastAPI 第二套后端。

## Toonflow-app

来源：[当前仓库 README](https://github.com/HBAI-Ltd/Toonflow-app)、[README 原文](https://raw.githubusercontent.com/HBAI-Ltd/Toonflow-app/master/README.md)。

当前公开仓库介绍短剧/漫剧、剧本、分镜、资产、模型自选、画布及扩展入口。借鉴创作与生成围绕同一镜头、参考资产复用、供应商配置集中管理的交互。不会据旧版本文章假定它当前仍使用 Electron/Express；版本演进不构成 Pullet 切换运行时的理由。

## Jellyfish

来源：[Forget-C/Jellyfish README](https://github.com/Forget-C/Jellyfish)、[README 原文](https://raw.githubusercontent.com/Forget-C/Jellyfish/main/README.md)。当前按这个 AI 短剧项目理解用户所说的 Jellyfish。

README 将镜头准备、候选确认、关联已有实体和生成执行分别处理。Pullet 后续 AI 拆解将先保存候选角色、场景、道具及对白，由用户确认后关联已有实体；准备状态与生成状态分别管理。模型输出不会直接覆盖已审核资产。共享 seed 只能保存可复现参数之一，不能单独承诺跨镜头一致性。

## LibTV

来源：[LibTV 公开页面](https://www.liblib.tv/)。用户提到的 `lib.tv` 未能直接访问，本轮按 LibTV 产品参考处理。仅核对公开入口，未登录、未验证内部画布功能与后端实现。

页面公开提供项目、资产、画布与多媒体创作入口。Pullet 后续采用画布作为同一业务数据的另一视图：节点引用 Project/Shot/Asset/Job ID，仅保存位置、缩放和连线，不复制业务数据。画布在主线生成、归档、审核完成后实施。

## 当前结论

- 当前：React + NestJS + Drizzle/SQLite，保留已完成权限测试。
- M3：计划默认数据库持久化任务队列，无 Redis 强依赖；租约、幂等与恢复必须通过故障测试。
- 未来：PostgreSQL 为扩展方向，需要单独适配与迁移；不是改连接串即可实现。
- 后续 Agent：提出候选和调用受控业务工具，保留人工确认点；不绑定特定厂商 SDK。
- 素材归档、工作区隔离、Take 不可变和任务追溯仍为产品基线。

后续若实际复用源代码或资源，再针对具体版本检查许可证与通知要求；本轮未做代码复用。
