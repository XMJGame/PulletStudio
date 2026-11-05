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
| 技术节点图 | settings原始图、节点弹窗及暴露字段 | 目前只有节点datalist和手填映射，没有图 | **G2-A**独立只读React Flow技术图，点节点挑常量绑定；不允许重连或执行导入JSON |
| 动态字段 | settings text/textarea/number/slider/boolean/dropdown/image/video/audio；含名称推断类型 | 已有正/负词、I2V首帧、画幅枚举/时长/seed及服务端/object_info绑定检查 | **部分已有，G2-A**将通用字段Schema增量接入；不能把上游推断当真实类型或把音视频输入UI当Provider已支持 |
| 模型/节点能力 | 上述设置流程有启发式类型推断；本次未核验完整模型依赖门禁 | ComfyProvider只校验已绑定输入/输出相关节点，非整张图的所有依赖 | **G2-A**补有界全部class_type/枚举依赖报告；**G2-C**与实例能力缓存匹配，未知能力明确标未验证 |
| 工作流列表/配置 | 配置与原图分文件、保存/删除 | generation_workflows已有不可变定义与Job冻结引用，尚无工作流家族/追加修订/审批/归档 | **部分已有，G2-A**补管理入口和版本关联；不物理删已被Job引用的工作流，不复制定义到第二事实源 |
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

1. **G2-A1（本包）**：复用并抽出已有连接/导入/绑定界面，增加项目级工作流中心、现有工作流列表、只读API节点图/安全字段选择。无需DB/API改动，不发/prompt。
2. **G2-A2**：开工前单独增量合同。现有generation_workflows行作为不可变定义，新增家族/修订关联及头指针，保留旧ID/Job外键；编辑/回滚追加新定义而非覆盖旧行。审批/测试证据与运行可用状态分开；归档不删历史。服务端Schema版本化暴露字段，兼容现有三类参数/旧Job快照；字段类型/范围/枚举来自受信实例object_info，有界依赖报告与明确未知状态。不先宣称支持视频/音频上传或任意JSON路径。
3. **G2-A3**：双层配置/表单预览和受控测试。成本确认、固定输入媒体、实际工作流修订、测试来源必须记录；需要生成时选择合法镜头/Artifact并复用Generation API，不伪造镜头、不绕过Job/Take门禁。不能用“测试”名义创建网页直连执行通道。
4. **G2-B**：正式Board的简化生成节点/Job引用、任务进度、结果版本比较及提交Take，沿用审批/选片；关闭Board任务继续，注释线不自动变执行线。
5. **G2-C**：ADR-010多独立实例管理、能力/健康/容量/授权、默认auto/高级manual、持久预留/恢复、实际实例冻结、双机实测；手动指定不可用不隐式换机。
6. **G3**：第二媒体Provider、必要素材工具、团队批量、参考采集和外部制作软件连接器按依赖逐包；交付/部署门禁继续保留，不为参考项目重写Production Core。

实际状态及测试结果只维护[IMPLEMENTATION-STATUS](../IMPLEMENTATION-STATUS.md)。
