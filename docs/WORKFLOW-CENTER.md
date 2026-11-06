# 工作流中心

在正式项目工作台点“工作流中心”，无需先创建镜头。管理员封装技术工作流，创作者在镜头“媒体生成”使用公开参数。两处共用GenerationSettings、Generation API、原队列和Storage。

只有既有`canConfigure`权限（实例管理员且具工作区管理权限）能配置连接/工作流；其他项目读者只看工作流名称、能力、连接启用状态和已暴露参数摘要，不返回服务器地址、凭据或原始技术图。连接仍是受信后端配置，停用影响生成可用性，没有新增实例调度。

## 导入与技术图

1. 选择已有连接，填写配置名称和生成方式，上传或粘贴ComfyUI **API格式JSON**。沿用1–200节点/160KB限制，不接受普通界面布局JSON。
2. 点“预览节点图”，只读查看class_type及输入连接。可拖视口/缩放/小地图，节点本身不能移动、改线或执行；也可用“选择工作流节点”下拉操作。
3. 选节点和常量输入，明确绑定正/负向文本、I2V首帧或输出。手工绑定与画幅/时长/seed仍保留；另可公开最多20项文本、数值、开关或字符串枚举参数。ID自动生成，名称面向创作者，默认值来自原图。字段目标不能重复；已知凭据、端点、路径及媒体上传输入不能公开为标量参数。
4. 图中默认只显示字段名/类型，不展示可能含密钥、路径的全部常量；不加载其中的外部媒体URL，不执行HTML、脚本或节点代码。技术预览最多600条线、20条警告、所选节点100个常量字段，超预览上限不会修改原JSON。
5. 缺端点/循环明确提示，预览不保证可执行。保存调用服务端/object_info绑定及公开字段校验，失败保留草稿。第一次建立目录v1；编辑已有配置须填写摘要，追加新定义/修订，旧任务继续使用旧定义。校验不等于整图真实运行通过。

关闭未保存的中心输入会要求继续或明确丢弃，刷新有原生未保存提示；草稿只在当前页面，不写Board/localStorage，也不承诺崩溃恢复。中心不发生成请求，实际任务仍在镜头入口选择Artifact/固定媒体并确认资源消耗后创建。

## 修订与创作参数

“历史”每页20项，可查看固定定义或确认“恢复为新修订”。恢复重新校验、继续递增编号。归档保留历史，阻止目录所有修订创建新任务，不停止已排任务、不阻止原请求重试核对；恢复使用须解除归档。旧定义各自接入v1，原ID不变，不按相似名称自动合并。列表目前最多100个当前配置/50个连接。

修订/归档采用目录CAS版本。冲突保留草稿；“载入最新配置”经明确丢弃后原子读取最新头部。新UI创建/修订/恢复使用UUID请求键，相同内容重试返回原结果，改内容409。不会因列表刷新静默替换创作者已选的固定修订及表单。

创作者选择合法镜头的已保存提示词/必要首帧，填写Schema表单并确认资源消耗，改值须重新确认。后端严格验证ID、类型、范围、步长、长度及选项；省略值采用原图默认，开关false有效。Job快照冻结实际图、原参数及fieldValues；历史显示当次工作流修订和参数名称/值。Worker对带新字段的任务提交前复核远端声明，继续原提交/核对/归档/Take流程；旧无字段任务不改快照或增加这次复核请求。

## 有界依赖报告

管理员对**已保存的固定定义**点“检查依赖”，不混入未保存草稿。后端读取受信实例/object_info，检查节点声明、必需输入、引用端点/输出位置/类型、常量范围、模型等枚举选项。不调用/prompt，不扫描或下载模型，不把诊断作为审批。

- 声明匹配：检查范围内匹配，不代表权重文件完整、显存充足或真实执行成功。
- 依赖不匹配：发现缺节点、缺输入、不可用选项、类型不符或环等明确问题。
- 尚未验证：网络失败、动态/未知Schema或达到预算，不当作通过。

按类型串行复用结果，最多64种类型、总时限15秒、总响应8MiB（单响应另限4MiB），每节点最多20条说明。报告只返回诊断代码/节点/输入名，不返回上游常量、地址、令牌或整份object_info。动态第三方节点仍需实际验收。

## API增量

统一前缀/api/v1，以下管理接口沿用原配置权限及项目访问权限。

| 方法/路径 | 合同 |
|---|---|
| POST `/projects/:id/generation-workflows` | 原定义增加可选fields及fieldSchemaVersion；新UI传UUID Idempotency-Key，旧调用可省略；返回id/familyId/revision |
| GET `/generation-workflows/:id/definition` | 固定定义及目录状态，仅管理员 |
| GET `/workflow-catalogs/:id/definition` | 事务内读取最新头定义/目录状态 |
| GET `/workflow-catalogs/:id/revisions?before=` | 20项历史及nextCursor |
| POST `/workflow-catalogs/:id/revisions` | expectedVersion、summary、definition；必需UUID请求键 |
| POST `/workflow-catalogs/:id/restore` | expectedVersion、summary、同目录workflowId；必需UUID请求键 |
| PATCH `/workflow-catalogs/:id` | expectedVersion、archived；CAS及审计 |
| POST `/generation-workflows/:id/inspection` | 固定定义诊断，附连接配置版本和时间 |

generation-config 的 workflows 列出目录当前修订。productionWorkflows 提供项目可选生产版本及启用状态。旧 parameters/parameterValues 和可选 fieldValues 继续有效，Job 读取返回冻结参数与工作流修订。字段 Schema 版本为 studio.workflow-fields.v1，省略时按 v1 解释。

## 受控试跑与项目发布

1. 从工作流中心保存配置，然后打开「试跑与发布」。配置管理员选择项目中的现有镜头。镜头需有与当前制作卡和项目设定匹配的已保存提示词。
2. 打开试跑表单，核对提示词、创作参数和必要的首帧。勾选资源消耗确认后加入试跑队列。试跑和正式生成使用同一个 Worker，并共享单镜头任务限制。
3. 等待「试跑证据已归档」，返回试跑记录预览或下载。证据固定到工作流修订、镜头、提示词、参数和连接版本。试跑证据保存在项目内，生产素材库、首帧列表、资产和画布引用以及 Take 使用生产素材。
4. 具有项目审核权限的成员选择该修订的试跑证据并填写意见，再确认发布。发布要求当前修订、未归档目录、启用的连接及该连接版本完成的试跑。已发布的修订可由项目创作者选择。
5. 审核者可撤回发布。新修订保存为草稿时，团队继续使用当前发布版本。发布替换或撤回影响新任务，之前已入队的任务按原快照继续。发布历史可打开当时的试跑证据。

工作流中心创建或编辑的修订进入审核流程，后续修订继承此规则。此前已保存的兼容版本，以及旧配置 API 和镜头内快捷配置创建的兼容版本，在目录首次正式发布前维持原使用方式。采用审核模式的目录可以保留之前的兼容生产版本，直至首次发布。项目内共享沿用现有 RBAC，跨项目模板共享另行规划。

| 方法/路径 | 合同 |
|---|---|
| GET `/generation-workflows/:id/test-shots?cursor=` | 配置管理员读取项目镜头，每页 30 项 |
| POST `/generation-workflows/:id/test-jobs` | 复用生成表单参数，以 shotId 选择镜头，以路径固定工作流。confirmed 必须为 true，使用 UUID 请求键 |
| GET `/generation-workflows/:id/test-jobs` | 项目成员读取固定修订最近 30 次试跑 |
| GET `/workflow-catalogs/:id/releases?before=` | 发布和撤回历史，每页 20 项 |
| POST `/workflow-catalogs/:id/releases` | 项目审核权限。publish 需要 workflowId、testJobId，revoke 针对当前发布。两者都需要 expectedVersion、reason 与 UUID 请求键 |

## 限制与下一门禁

G2-B 接入正式画布的镜头生成、候选比较和 Take 审核，G2-C 接入多实例能力匹配和调度。本阶段的模型执行验收使用隔离 ComfyUI Mock。真实模型兼容性由对应工作流的实机试跑验证。

`npm run test:workflows` 包含图解析与 6 项浏览器验收。它与 test:boards 共用隔离端口 3112/5192，须顺序执行。试跑功能使用同一版本的 API 和 Generation Worker。详见 [A3 合同](modules/WORKFLOW-CENTER-G2-A3.md)和[验收](history/WORKFLOW-CENTER-G2-A3-2026-11-06.md)。
