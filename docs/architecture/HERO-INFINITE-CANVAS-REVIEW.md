# hero8152/Infinite-Canvas：功能研究与采用决策

2026-11-05，只读核验提交`67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e`。这是新参考项目，**不同于**basketikun/infinite-canvas；后者的G0/React Flow选型结论保留。未运行上游、安装插件、调用其推荐API或复制源码/资源到Pullet。参考副本仅在忽略的data/references下，不随产品分发。

## 证据与边界

- [LICENSE](https://github.com/hero8152/Infinite-Canvas/blob/67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e/LICENSE)限制商业封装，并对基于源码二次开发附加开源/署名条件。按用户要求只研究功能/交互，Pullet独立实现；不把该许可证误称MIT，也不因另一同名仓库为MIT而套用。
- [README](https://github.com/hero8152/Infinite-Canvas/blob/67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e/README.md)标记2026-08-28停更、引导另一产品；新产品的Agent/协同/APP等宣传不能当成本仓库已验证功能。第三方服务支持声明不等于本次实际联通或授权/稳定性验收。
- 定向读取[工作流设置](https://github.com/hero8152/Infinite-Canvas/blob/67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e/static/js/comfyui-settings.js)、[创作画布](https://github.com/hero8152/Infinite-Canvas/blob/67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e/static/js/smart-canvas.js)、[API设置](https://github.com/hero8152/Infinite-Canvas/blob/67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e/static/js/api-settings.js)、[后端](https://github.com/hero8152/Infinite-Canvas/blob/67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e/main.py)、[浏览器采集](https://github.com/hero8152/Infinite-Canvas/blob/67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e/tools/chrome-local-asset-importer/README.md)、[Photoshop连接器](https://github.com/hero8152/Infinite-Canvas/blob/67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e/tools/photoshop-asset-connector/README.md)。范围为入口、字段/媒体映射、预览/执行、队列选择及连接合同，不声称逐行审计全部源码。

## 能力对照与取舍

| 功能 | 上游看到的证据 | Pullet实际代码/现状 | 分类与决定 |
|---|---|---|---|
| API JSON导入 | settings上传/get/list，main.py文件式保存 | GenerationDialog＋workflowInput/createWorkflow已导入、严格校验、存独立不可变行 | **已实现，G2-A改善入口/交互**，不再建第二套导入服务 |
| 技术节点图 | settings原始图、节点弹窗及暴露字段 | A1已独立实现只读React Flow技术图、节点/常量选择及绑定 | **已实现**；不允许重连或执行导入JSON |
| 动态字段 | settings text/textarea/number/slider/boolean/dropdown/image/video/audio；含名称推断类型 | 原三参数保留；A2增量text/number/boolean/字符串enum，服务端核对声明、生成表单及冻结Job | **标量已实现，媒体后置**；不能把上游推断当真实类型或音视频UI当Provider能力 |
| 模型/节点能力 | 上述设置流程有启发式类型推断；本次未核验完整模型依赖门禁 | A2有界检查节点/输入/连接/常量/模型枚举，动态未知明确未验证 | **报告已实现，G2-C匹配后置**；不等于实际权重完整或真实运行成功 |
| 工作流列表/配置 | 配置与原图分文件、保存/删除 | 原定义/Job保留；A2目录修订/历史恢复/归档/CAS/保存幂等 | **目录已实现，审批/共享待A3**；不物理删除历史，不复制定义到第二事实源 |
| 双层体验 | settings技术图与mini测试画布切换；smart-canvas消费已暴露字段 | G1正式Board不执行生成；镜头GenerationDialog已有任务表单 | **G2-A**配置/校验预览，**G2-B**简化正式生成节点；测试也走既有Job，不从网页直连Comfy、不造假成功 |
| 多后端与选择 | settings地址列表；main.py get_best_backend/reserve_best_backend检查远端队列、进程内负载和已有输入文件 | workspace多连接可登记，但工作流仍固定单连接；无实例调度 | **G2-C**。上游不只是地址列表，但该入口未见Pullet所需完整工作区授权/模型匹配/持久租约保证；按ADR-010独立实现auto/manual，不照搬第一地址兜底或进程内计数 |
| 任务与结果 | settings/run、smart-canvas调用/轮询/结果展示 | 既有GenerationJob租约、幂等、未知提交核对、真实原件/MediaVersion/Take归档 | **已实现基础，G2-B**接画布进度和比较；不新建队列，不把远端完成直接显示为归档成功 |
| 镜头/资产追溯 | 上游画布组合输入媒体/提示词 | G1固定卡/实体/媒体；Job冻结卡/Artifact/工作流/参数/首帧，Take审核/选片已实现 | **已有，G2-B**连通界面；多参考/首尾帧等须能力声明及传输验收，不靠画布线自动改卡 |
| 多Provider | README列OpenAI/Gemini/方舟/RunningHub/ModelScope/即梦；settings有协议配置分支 | 文本兼容适配＋Comfy原生媒体Provider，未完成第二媒体Provider | **G3**逐个官方合同、凭据、费用/恢复/输出归档验收；不导入推广API地址或声称一协议适配全部 |
| 媒体与素材工具 | README/画布有帧抽取、全景/扩图等入口 | 媒体探测/封面/鉴权预览、FFmpeg和标准交付已实现 | **已有基础，G3选做**确切版本帧抽取、参考图处理、全景检查；新衍生媒体保留来源，不破坏原件 |
| 浏览器采集 | 插件README明确扫描/选取/导入、下载、blob/data等来源及限制 | 已有文件上传、版本和权限，没有浏览器连接器 | **G3**用户主动选取、记录来源/权利、限量导入原Storage；采集结果先草稿，不直接批准，不把外部URL/Blob放Board |
| Photoshop | UXP README的置入/PNG导出、库浏览及WS；生成页仍含路线图 | 无外部软件连接器 | **G3按需**最小权限、显式导入/导出及版本来源；不采用全域网络/CORS *或裸静态媒体作为多人授权模型 |
| 协同/Agent/插件 | 当前README新产品宣传，未验证本仓库对应完整实现 | 项目RBAC/CAS已有，CRDT/Agent/动态插件未做 | **后置**受控业务工具与明确权限；远程动态脚本执行/任意APP不是V1必需 |
| 专业后期/模型安装/显存合并 | 不据展示入口推定成熟生产能力 | ADR-009/010明确边界 | **不引入**完整Comfy编辑器、专业剪辑器、自动模型下载/进程管理、跨GPU显存合并；不改变用户设备部署 |

## 产品与实施顺序

接受：工作流中心封装技术图，创作画布消费简化合同；原始图/映射/预览分层，追溯统一，后续能力匹配/实例选择由后端完成。调整：G1已经63c14ae完成，不重新实施；G2-A不是从零建立工作流系统，不以“全面兼容任意工作流/模型”为验收标准。

1. **G2-A1（已完成）**：共享配置入口、项目工作流列表、只读技术图及点选绑定；当时无DB/API改动，不发/prompt。
2. **G2-A2核心（已完成）**：按独立合同增量目录/修订/恢复/归档及请求幂等，保留旧ID/Job外键；标量Schema端到端及有界依赖报告。字段由管理员声明并核对受信object_info，不采用名称推断作为真值。正式审批/共享与测试证据继续A3，不声称音视频通用输入或任意JSON路径。
3. **G2-A3**：正式审批/共享边界、双层配置/表单预览和受控测试。成本确认、固定输入媒体、实际修订及测试来源须记录；选择合法镜头/Artifact并复用Generation API，不伪造镜头、不绕过Job/Take门禁。不能用“测试”名义创建网页直连通道，不自动封禁兼容旧工作流。
4. **G2-B**：正式Board的简化生成节点/Job引用、任务进度、结果版本比较及提交Take，沿用审批/选片；关闭Board任务继续，注释线不自动变执行线。
5. **G2-C**：ADR-010多独立实例管理、能力/健康/容量/授权、默认auto/高级manual、持久预留/恢复、实际实例冻结、双机实测；手动指定不可用不隐式换机。
6. **G3**：第二媒体Provider、必要素材工具、团队批量、参考采集和外部制作软件连接器按依赖逐包；交付/部署门禁继续保留，不为参考项目重写Production Core。

实际状态及测试结果只维护[IMPLEMENTATION-STATUS](../IMPLEMENTATION-STATUS.md)。
