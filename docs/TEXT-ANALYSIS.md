# 文本模型与 AI 分镜分析

文本分析打通“已保存原文→指定模型→后台队列→带来源的待审核草案”。分析完成不会自动写入正式镜头或改写剧本。后续已增量交付人工编辑、拒绝/重开及明确采纳，见 [草案审核与制作卡](PROPOSAL-REVIEW.md)。Story Bible、提示词编译和导出尚未实现。自动化验收使用独立本机 Mock，尚未验收用户的真实模型。

## 启动与配置

API、Web 沿用原启动命令。先运行 `npm run setup`：已有 .env 保留原初始化/账户设定，只在缺少 Provider 加密密钥时补充，不打印密钥。构建后在单独终端运行：

```powershell
npm run build
npm run worker:text
```

Worker 是独立 Node 进程，使用相同 DATABASE_PATH、PROVIDER_MASTER_KEY；V1 在同一可靠本地盘上运行，数据库不放 NAS。默认一个文本 Worker，每进程一次处理一项；没有 GPU 或 Redis 也可启动。SIGTERM/SIGINT 停止领取新任务，当前有界请求结束后关闭；强制退出按租约恢复。任务期间心跳每 5 秒持久化，页面以最近 15 秒心跳提示在线，不代表模型可用性。

项目工作台→“AI 分镜”→“文本模型连接”。已加入工作区且有工作区管理权限的实例管理员可以新增并批准端点；工作区管理员可以为已批准连接添加模型、更新凭据、停用/启用。保存连接不发模型请求。

- API 基础地址填写兼容服务的基础 URL，如 `https://<你的端点>/v1`，不要重复填写最终生成路由。
- 连接与模型配置分表；同一连接可添加多个模型。模型名由服务方提供，不预选某个厂商或模型。
- 结构化输出可选 JSON Schema、JSON Object 或仅提示词约束 JSON。服务不支持某模式时明确失败，不自动换模式再扣费。
- 输出上限参数可选 max_tokens/max_completion_tokens；最大输出 256–16,384，超时 10–300 秒。能力兼容性须以具体服务实测为准。
- 自部署本机/内网及 HTTP 需实例管理员勾选批准。公网默认 HTTPS；端点无 URL 凭据/查询参数，发送前解析全部地址并固定连接 IP，不跟随重定向；拒绝 link-local/已知 metadata 地址。不要把未受控端点当成任意 URL 抓取工具。
- API Key 仅写入，AES-256-GCM 加密存库，API 只显示是否存在。更新凭据框留空意味着移除凭据，原凭据不回显。端点基础 URL 建立后暂不提供修改；需要不同端点可另建连接。

兼容协议实现参考官方 [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 与 [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)。兼容服务不一定支持全部参数，当前 adapter 不实现 Responses、工具调用或供应商 SDK。没有在线探测/自动选模型功能。

## 分析与草案

先在项目剧本保存或导入原文。选择模型和范围，可填写已经确认的上下文摘要；勾选确认后创建任务。每次只发送所选原文块（最多 8,000 UTF-16 单元）、摘要及项目格式/叙事/风格/导演等设定，不发送其他范围的正文。单块最长 2,000，单批最多 40 个块；CRLF、空行和 emoji 保留。范围基于不可变修订，以半开区间显示；长行会进一步拆分，引用 ID 对应实际字符偏移和 SHA256。

同一页面对相同输入重复提交复用 Idempotency-Key，打开原任务。确实需要另一轮时先点“准备新一轮分析”，再次提交会另建任务并可能再次计费。改变模型、范围或摘要会形成不同请求。幂等键当前保存在页面内存，刷新页面后请先查看已有任务，避免无意另建。

任务冻结原文修订/哈希、项目设定、连接/模型版本、输入摘要和输出 schema。配置/凭据在发送前变化会拒绝旧任务，应确认新配置另建任务；已经发出的调用仍按原快照处理。用户离开项目或项目进回收站时，排队任务不会继续发送。正在调用期间撤权/删除无法收回已发送数据，返回时不再发布草案。

模型输出必须是符合制作卡 schema 的 JSON，引用只可使用本次范围的来源块。无效 JSON、字段缺失、越界/重复来源不会登记草案。时长未知可为 null，不把固定 5 秒当作旁白测量。草案显示意图、画面、镜头、动作、光线、声音、建议制作方式、候选资产和风险点，并可展开原文引用。

## 状态、重试与恢复

| 状态 | 含义与处理 |
|---|---|
| queued / preparing | 已持久化排队 / 准备，尚未提交；准备阶段失租可重新领取 |
| submitted | 已开始发送受控请求；不代表已知远端任务 ID |
| retry_waiting | 明确 HTTP 429，至少等待 Retry-After；最多自动重试 3 次 |
| needs_reconciliation | 已提交后断线/超时/5xx/失租，是否执行或计费未知；不自动重发 |
| failed | 参数、模式、凭据、输出或权限等失败；查看安全错误说明 |
| cancelled | 停止本地跟踪/结果发布，不代表远端已取消 |
| completed | 有效待审核草案已在同一事务登记；不代表正式镜头或媒体已生成 |

租约是请求超时加 30 秒，所有领取、发送门禁及完成登记都校验所有权；旧 Worker 失租后即使返回结果也不能发布。HTTP 响应最多 2MiB，错误不回显供应商原始响应。进度保存在数据库，刷新可继续查看；当前为轮询，没有 SSE。

失败/待核实任务可以在人工核实后勾选可能再次调用/计费，再明确重新排队；重排使用原快照。若原连接已变更或原请求者已失去权限，应由当前有权用户确认设定并另建任务。请求追踪号用于辅助查看供应商日志；通用兼容接口没有统一的远端历史查询/自动调和保证。

## 数据、迁移与备份

0010_smart_hammerhead 追加 text_connections、text_model_profiles、analysis_runs、analysis_proposals；0011_analysis_evidence_guards 保护原文范围关联、任务输入快照和原始草案。原有表不重建，业务数据不改写。API 与 Worker 启动先通过 SQLite immediate 事务读取迁移日志，使用 Drizzle 的迁移文件与日志格式，防止并发启动重复应用同一迁移。

迁移前备份：`data/backups/studio-2026-11-04T12-42-46-630Z-e6df76ea.sqlite`。回退沿用 `05-DEVELOPMENT.md`：停服务、保留当前库、复制快照至新本地路径、修改 DATABASE_PATH，不能覆盖运行中的库。旧快照不含本阶段新增任务。

恢复包含 Provider 凭据的数据库时，需要原 PROVIDER_MASTER_KEY；应单独安全备份，不能把 .env 公开提交。setup 不会轮换已有 key，密钥轮换程序尚未实现。丢失 key 时旧凭据不能解密，需要重新录入；历史原文/草案仍可读取。

## API 概览

前缀 `/api/v1`：

- GET/POST /workspaces/:id/text-connections；POST 创建连接可附首个 profile。
- PATCH /text-connections/:id：expectedVersion + name?/enabled?/apiKey?；不接受修改 URL 或私有信任范围。
- POST /text-connections/:id/models：追加模型配置，不覆盖旧配置。
- GET /projects/:id/analysis-chunks?revisionVersion=1。
- GET/POST /projects/:id/analysis-runs：POST 必须带 UUID Idempotency-Key、modelProfileId/revisionVersion/chunkIndex/contextSummary?/expectedProjectVersion/acknowledgeExternalProcessing=true。
- GET /analysis-runs/:id：状态、追踪、冻结设定、来源和候选草案。
- POST /analysis-runs/:id/cancel 或 /retry：expectedVersion，retry 另需 acknowledgePossibleCharge=true。
- GET /workspaces/:id/analysis-status：后台心跳。

工作区管理控制连接配置，项目编辑权限控制分析提交/重排/停止，项目查看权限控制历史和草案。项目回收站内所有这些项目接口均不可用。任务列表按 ID 分页每页 30；连接列表当前最多返回 100 个连接，超大配置规模尚未验收。

CI 配置已添加 `.github/workflows/checks.yml`，包含 Node 24、类型/格式、接口、隔离 Chromium E2E；2026-11-05 初始化 Git 并配置 GitHub 远端，执行结果以 GitHub Actions 为准。本文描述 P2-A 文本分析；最新人工采纳能力见独立审核文档。真实模型/成本/吞吐、长片 Story Bible 分层、PromptCompiler 和媒体生成尚未验收。
