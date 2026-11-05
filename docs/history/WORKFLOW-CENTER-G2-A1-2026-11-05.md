# G2-A1工作流中心与只读技术图 — 2026-11-05

基线63c14ae/G1。用户新增hero8152/Infinite-Canvas为长期功能参考；要求研究工作流、动态字段、多后端/Provider、媒体/采集/外部工具，按四类能力作取舍，独立实现且不打断已有系统。完整研究见[能力对照](../architecture/HERO-INFINITE-CANVAS-REVIEW.md)，实施前[合同](../modules/WORKFLOW-CENTER-G2-A1.md)。

## 实际完成

- 固定上游67f49e4b9a0ac090bad1f5bd62ae385f8fb5394e，只读克隆到忽略的data/references，未运行/安装/导入上游实现或资源。README已标2026-08-28停更，许可证限制商业封装，不能与basketikun的MIT混用。研究记录区分源码入口、README声明、未实机能力及不采用的安全/架构策略。
- 项目新增“工作流中心”，使用原generation-config与原配置POST；浏览已有名称/能力/参数/连接状态，按原canConfigure授权。配置界面从GenerationDialog提取至workflows/GenerationSettings，共用同一表单/服务，旧镜头入口保留。无DB/API变更、无新增依赖、无用户数据/ComfyUI/模型盘位修改。
- API导入JSON安全只读React Flow图，Kahn分层、输入二元引用、缺端点/环警告；最多200节点/160KB、预览600边。点击或下拉选节点/常量，明确设置正/负/首帧/输出映射，保存仍经原后端绑定校验。无外部URL加载/HTML执行/节点代码执行，不创建Job、不直接访问ComfyUI。
- 配置失败/文件错误保留草稿，中心关闭/刷新提示未保存。桌面列表与配置独立滚动，390px改纵向；默认图不展示可能含凭据/物理路径的常量，仅字段名与类型。

## 验证

| 检查 | 实测结果与范围 |
|---|---|
| `node --import tsx --test tests/workflows/graph.test.mjs` | 4/4，API/UI JSON区分、BOM/字节/节点上限、确定性/不改原图、环/缺端点、边上限及特殊键不污染原型 |
| `npx playwright test --config playwright.workflows.config.ts` | 3/3，7.5秒；独立SQLite/API/Vite，复用隔离ComfyMock只做object_info，不发/prompt。真实配置创建/绑定成功与失败保留、只读/撤权/凭据不返回、JSON恶意文本/URL不执行、390px及关闭保留 |
| `npx playwright test` | 原生产1/1，53.4秒含启动、48.3秒场景；原连接/工作流配置、图片/I2V/动态三参数、生成/审核/交付/预演继续通过 |
| `npx playwright test --config playwright.boards.config.ts` | G1正式画布4/4，15.9秒；固定版本、权限、恢复/冲突、真实媒体和交互继续通过 |
| 类型/格式/Web构建 | 全workspace类型、Prettier、Web构建通过；新图/中心懒加载，未引入上游依赖 |

本轮只改Web与文档/验证配置，API187项与G0六项沿用G1记录，不因文档或提取重复全量。CI新增图解析/工作流浏览器配置，远端执行结果不由本地通过推断。浏览器初次调试为原select嵌套label的精确定位，补明确aria-label后通过，未跳过测试。自动截图在忽略的test-results/workflow-center-desktop.png、workflow-center-mobile.png，已核对独立滚动、移动无横向溢出及失败时保留状态。

最终扫描69份Markdown、205个本地链接，无缺失；Git差异检查通过。没有把参考仓库、截图、数据库、媒体或凭据加入提交。

## 明确未完成

整个G2-A尚未完成：通用字段Schema、视频/音频/多参考传输、完整object_info/模型依赖报告、旧配置原图/家族修订/审批/归档、受控测试画布。既有创建配置API尚无幂等请求键，中心不自动重试不确定保存，应刷新列表核对。G2-B正式画布生成/结果比较/Take、G2-C多独立实例及G3插件/素材工具仍待逐包；当前不新增工作流执行DAG、完整Comfy编辑器、专业剪辑或第三方动态脚本。
