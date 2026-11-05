# ADR-008：创作画布参考与渐进接入

状态：G0交互对照后采用React Flow，G1正式Board/固定引用/权限已在63c14ae交付；生成闭环待G2-B。DOM只保留实验对照。2026-11-05。

补充参考：hero8152/Infinite-Canvas与本文basketikun仓库不同，许可不能混用；前者仅按[只读能力研究](architecture/HERO-INFINITE-CANVAS-REVIEW.md)参考工作流配置/技术图、简化画布、Provider及连接器，Pullet独立实现。工作流中心配置技术合同，正式创作画布消费合同，不把ComfyUI编辑器或第三方动态脚本带入V1。

用户要求评估 basketikun/infinite-canvas 并自主规划。粘贴材料中的原型、Fork、安装及 Agent 命令均按参考内容处理，本轮没有执行。保留现有 React/NestJS/Drizzle/SQLite 和 ADR-005 的统一生产内核。

## 核验与取舍

核验上游提交 [9cd3dea](https://github.com/basketikun/infinite-canvas/commit/9cd3deacbcc598361807afc16c059a80dd18b6f9)，仅阅读源码，没有安装、运行或复制代码。

| 核验入口 | 实际看到的机制 | Pullet 决策 |
|---|---|---|
| [视口](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/components/canvas/infinite-canvas.tsx) | DOM transform、自定义平移/指针捕获、指针中心缩放、requestAnimationFrame 合并更新 | 学交互；不能据此认定整套大图性能已通过验收 |
| [节点类型](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/types/canvas.ts) | Image/Text/Config/Video/Audio/Group；节点 metadata 包含内容、生成参数及结果；边是节点 ID 对 | 学媒体预览与生成配置；不照搬其业务内容、参数、结果到第二份生产数据 |
| [状态存储](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/stores/canvas/use-canvas-store.ts) / [README](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/README.md) | Zustand persist/localForage，400ms延迟本地保存；README说明默认本地配置/素材/生成历史、前台直连 API，历史格式不保证兼容 | Board 在服务端追加版本、CAS/409；浏览器可保留恢复草稿；共享凭据和模型调用继续留在后端 |
| [Registry](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/lib/canvas/node-registry.ts) / [插件加载](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/lib/canvas/plugin-loader.ts) | 类型注册、动态菜单、远程源码 fetch 后 Blob import，在页面中执行 | 借鉴内置类型注册；首版无远程脚本插件，后续隔离扩展另立合同 |
| [Agent README](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/canvas-agent/README.md) | 本机桥接、token/Origin、MCP 状态读取及操作协议 | 后续受控工具可参考操作批次；本轮仅核对文档，未审计整个 Agent 执行实现 |

根 [LICENSE](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/LICENSE) 为 MIT、版权 basketikun 2026。README 另有二次开发保留作者及前端标识的说明。实际复制前逐文件确认许可、第三方资源和通知，记录来源及改动；本轮无复制，不引入其标识、广告、提示词合集或安装脚本。

## 产品与复用边界

生产工作台继续承担剧本、镜头、审核、选片和交付；创作画布提供参考图编排、提示词探索、候选比较和生成入口，两者共享业务 ID。按制作单元/场景分 Board，桌面优先编辑，手机优先查看和操作任务。

- 复用 assets/entities、entity-references、MediaService、PromptArtifact、GenerationService、TakeReviewService；复用 Timeline/Animatic 作为后续预演出口。
- 新 Board/BoardRevision 只记录布局、引用、边、折叠和版本；独立便签可以保存创作草稿，不成为第二套 Shot/Asset/PromptArtifact。正式引用明确固定 revision/mediaVersion/job ID，并显示陈旧、无权或缺失状态。
- 新增 Board 数据为未来增量迁移，本轮不改数据库。读写沿用 workspace/project RBAC、回收站、声音权限、expectedRevision/409、幂等和审计。
- 引用连线不意味着已修改制作卡；显式提交才能通过原业务 API 追加卡/资产修订。执行边的类型、槽位、循环、工作流能力在服务端验证，画布不会把未支持的多参考图连线假装成可执行工作流。
- 现有生成 API 是 Shot 作用域。首个可执行画布先围绕已有镜头展开；纯资产探索若要脱离 Shot，需要另做兼容的生成目标合同，不创建虚构镜头或绕过审批。自由文本也不能直接代替已冻结 PromptArtifact。
- 生成结果归档仍为固定媒体版本与草稿 Take，批准和选用继续走既有流程。画布关闭后任务由既有 Worker 继续执行。

## 排期与验收

2026-11-05用户明确不需要剪辑功能，独立音轨/混音/字幕编辑不再作为前置包。后续进入 Phase G 的以下小包，不把完整 Skills/Agent 作为首版画布前置条件；已交付简单预演保留为可选能力。

进一步产品评估见ADR-009：先补一个小型标准交接包（复用原ZIP、固定CSV/制作说明），随后继续G0/G1；声音素材和可靠SRT交付可按需独立加入，不因取消剪辑器一并取消。

| 包 | 实施前需确定的改动 | 验收边界 |
|---|---|---|
| G0 受控底座对比 | 独立实验入口；相同30/50个混合节点、相同缩略图及交互脚本；React Flow 与最小自研视口适配；无正式数据迁移/模型调用 | 拖拽/平移/缩放/框选/类型连线/Inspector/布局恢复；记录运行环境、帧间隔p95、长任务、可见媒体和实现成本。目标50节点交互p95≤33ms；非视口视频不自动播放。目标是门槛，尚无实测数据。限制一个原型工作包，能满足要求即停止扩展对比 |
| G1 资产与镜头看板 | 新增Board服务/增量版本表/权限接口，Web BoardWorkspace与内置节点、Inspector；引用现有业务服务 | 同一镜头从列表与画布读到相同版本；刷新恢复布局、两窗口409保留输入、无权引用不泄露、缩略图/手机查看；首版不要求可执行DAG |
| G2 镜头创作闭环 | Generation/Prompt/Take现有接口适配、支持能力的端口验证、任务节点和结果比较；仅有明确缺口时增量API | 镜头→固定参考/提示词→现有生成任务→候选→审核/选用；关闭页面继续执行，失败重试不重复计费提交 |
| G3 自由资产探索及扩展 | 另写资产生成目标、草稿提升、类型DAG和受控Skill合同，再确定DB/API/UI | 候选显式提交资产修订，无第二套任务/素材库；第三方插件、MCP、实时CRDT和复杂Recipe按需另包 |

G0 之前不替换蓝图选型。若证据建议自研底座或核心架构改变，先报告维护成本、迁移影响和证据并等待确认。基础组件选型的兼容细节自主处理。

初次评估只阅读源码。随后G0已独立实现两底座的交互对照，结果见[阶段记录](history/CANVAS-G0-2026-11-05.md)，用法见[CANVAS-LAB](CANVAS-LAB.md)。两底座在本机合成样例下均达到原型目标，未发现需要自研的性能证据；React Flow提供小地图、原生拖线、边与节点键盘操作、选择/可见性等更完整能力，对照DOM需自行维护。继续React Flow，不切换业务架构，也不维护第二套正式引擎。

### G0实际借鉴与实现

- 用户要求后，将上游固定提交再次只读克隆到忽略目录，除前述文件外，实际读了[资源引用解析](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/lib/canvas/canvas-resource-references.ts)、[生成输入组合](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/components/canvas/canvas-node-generation.ts)、[配置面板](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/components/canvas/canvas-config-node-panel.tsx)、[连线组件](https://github.com/basketikun/infinite-canvas/blob/9cd3deacbcc598361807afc16c059a80dd18b6f9/web/src/components/canvas/canvas-connections.tsx)及canvas-node.tsx结果组/主结果逻辑。
- 采用输入来源可见、媒体与提示词节点、配置节点、结果并排比较/主方案、Inspector和适度快捷键的交互；不复制其代码/样例素材/远程脚本/浏览器密钥/Agent安装流程。
- 正式增量依赖是MIT的@xyflow/react 12.12.1，保留默认署名；20个新增包锁定版本/完整性，MIT/ISC/BSD-3-Clause原许可随public/canvas-third-party-notices.txt进入Web构建。此许可文件只覆盖本轮新增包，不冒称全系统许可审计完成。
- 实验单独入口/lab本地JSON，无正式DB迁移，无生产请求，无模型调用。G1仍须写真实Board/引用/权限/并发/备份合同。
