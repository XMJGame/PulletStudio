# 正式创作画布（G1）

在项目选择“创作画布”，或在制作结构选择单元后点“打开单元画布”。填写名称即可创建；标识由系统生成。项目入口列出该项目所有画布，单元入口按单元筛选，每页20条；共用原项目权限，不另授予资源访问权。

## 创作与保存

左侧从本项目选择镜头、角色、场景、道具、声音资产或媒体版本。旧基本镜头须先保存完整制作卡，才有可固定的版本。资产草稿可用于探索，但明确显示未批准。便签、创作说明和分组不创建正式业务对象；本地文件须先经原素材上传流程登记。

拖拽节点，Shift多选，框选模式拖空白区域；Space拖动平移，滚轮缩放，也可用控制条和小地图。Delete/Backspace删除所选节点/连线，输入框内正常编辑。输出连到输入仅表达创作关系，不能连接自身、重复边或分组端点，注释允许成环；不改镜头、资产、审批或Take，不触发生成。

右侧检查器查看摘要、固定版本、业务详情及原件，预览复用原鉴权网关。通过检查器设置分组成员、折叠；移除分组只解散分组，保留子节点。手机采用上下布局，适合浏览和简单编辑，复杂编排推荐桌面。

“保存画布”追加不可变修订，保存标题、布局、连线、分组/折叠、视口及固定引用。重新打开/刷新从服务端恢复，不依赖G0的localStorage。无编辑权限只能浏览、检查和预览。关闭未保存草稿须明确丢弃或继续，刷新触发浏览器原生提示。未保存草稿只在当前页面内存，不承诺崩溃恢复。

## 固定引用、状态及冲突

- 镜头为Shot ID＋完整卡version；实体为实体ID＋revision ID；媒体为MediaVersion ID，不复制完整业务数据。
- 业务更新显示已有新版本，仍用旧引用；资产草稿/撤销批准分别标记。无权或缺失引用只返回安全占位，不带原名称/封面/详情。媒体实文件缺失/编码不支持在预览时提示，固定引用不变；画布读取不整包探测每个媒体。每15秒、窗口聚焦或手动刷新权限/引用，详情打开前重新授权；已下载内容无法远程擦除。
- 两窗口从同一基线保存，后写返回409、保留草稿。可只读比较最新/历史，明确载入最新（丢草稿需确认），或“保留草稿，更新基线”，核对后再保存。后者是用户选择以自己的完整草稿形成新修订，**不自动合并**；对方版本保留在历史。
- 失响应重试内容和基线不变时沿用同一请求键、恢复原修订。变内容使用新键，仍受CAS保护；失败不显示成功。

## API与合同

前缀`/api/v1`，沿用会话/CSRF/项目RBAC。服务端严格校验，不接受额外地址、密钥、路径或媒体内容字段。

| API | 合同 |
|---|---|
| GET /projects/:id/boards?unitId=&cursor= | read，20条，单元必须属于项目 |
| POST /projects/:id/boards | edit，`{title,unitId?:UUID|null}`＋UUID Idempotency-Key，返回v1 |
| GET /boards/:id?revision=N | read，当前/历史，含headRevision、canEdit及当前授权resolved |
| GET /boards/:id/revisions?before=N | read，20条版本/标题/作者/时间 |
| POST /boards/:id/revisions | edit，`{title,expectedRevision,layout}`＋UUID Idempotency-Key；冲突409 |
| GET /projects/:id/board-sources?kind=shots\|entities\|media&q=&cursor= | read，20条真实来源，空页仍可能有下一游标 |
| POST /projects/:id/board-references/resolve | read，`{references:[{nodeId,ref}]}`最多100项，空请求也授权 |

共享类型在packages/contracts/src/board.d.ts，执行验证在boards/board-contract.ts。schemaVersion=`studio.board.v1`；100节点/200边/布局256KiB；HTTP总JSON也限256KiB，含信封过大可能413。标题100字符、便签4000字符；节点UUID唯一、note/brief/reference/group，尺寸180–1600×120–1600、坐标±50000，视口±100000、zoom 0.15–2，一级分组，连线端点存在且类型有效。新加伪造版本/跨项目/无权引用拒绝；既有不可访问引用仅同节点同引用保留/移动，不能复制成新无权节点。

新表boards/board_revisions，范围外键、连续版本/head/不可变SQL保护、请求哈希及事务内审计。0032建表；0033为空的已应用历史文件，保留原字节；0034加保护，不改旧迁移或旧表。[实施合同](modules/CANVAS-G1-IMPLEMENTATION.md)记录兼容和备份。

G0仍是独立`/canvas-lab.html`，不作为正式数据入口。G1不做模型生成、执行DAG、CRDT、远程插件或剪辑器。G2通过原Generation API接固定输入/PromptArtifact、任务、候选比较和Take；之后实施[多独立实例](ADR-010-comfy-instances-and-board-boundary.md)，地址与密钥不进入Board。

验收命令`npm run test:boards`：独立SQLite/媒体及3112/5192端口，不写用户项目，不调用模型。最新结果见[当前状态](IMPLEMENTATION-STATUS.md)。
