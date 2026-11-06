# L1 无镜头创作验收

2026-11-06，基于 8a130d2，依据用户产品 V2 与 ADR-011。本阶段合同为 [LIGHT-CREATION-L1](../modules/LIGHT-CREATION-L1.md)。

## 已验收

- 共用 Generation Job/Worker/Provider/Storage/路由，新任务项目/可选 Board 归属，Shot/PromptArtifact/Take 均不生成；外部正负词和来源冻结。
- 空项目/空 Board/便签文字→未发布的已保存 T2I→真实文件探测→候选预览/下载/入库/复用/回画布→保存/刷新恢复；无镜头管理员试跑完成并继续隔离。
- API 单首帧 I2V 从通用图片结果继续；远端已接收但提交响应丢失后，重启 API/Worker 再核对，原实例仅提交一次，结果完成且 Take 为空。
- 旧 Shot 提示词、制作卡/审批门禁与 Take 路径保持原行为；只读账户不可生成/入库/试跑，外项目不能查看任务。入库重复请求仅一次审计，不复制媒体。
- 项目主页和手机生成表单已检查截图，兼容导航折叠，G0 原型不再占正式入口。
- 收尾修正项目分页的加载游标；0040 为通用实例池任务增加专用租约前缀与索引，旧池 Worker 不能领取新上下文。API 额外验证手动指定实例的无镜头生成完整归档。

## 命令和结果

| 命令 | 结果 |
|---|---|
| `npm run build` / `npm run typecheck` / `npm run format:check` | 通过 |
| `npm test` | API 203/203 |
| `node --test apps/api/test/workflow-migration.test.mjs` | 增补已完成 Job/媒体/Take 后，两个升级场景均通过 |
| `npm run test:workflow-graph` | 4/4 |
| `npx playwright test --config playwright.workflows.config.ts` | 9/9，含新自由创作/无镜头试跑和原 8 场景 |
| `npx playwright test --config playwright.boards.config.ts` | 5/5 |
| `npx playwright test --config playwright.config.ts` | 1/1，原生产全流程，46.9 秒 |

回归中旧浏览器脚本原先假定制作工具总是可见。改为显式展开兼容入口，并保持旧业务断言；新场景单独断言新项目默认创作页、无已保存提示词选择器与无 Shot/Take。所有模型请求为隔离 Mock，未调用用户 ComfyUI。

## 数据与迁移

生成迁移前备份 `data/backups/studio-2026-11-06T03-41-24-165Z-d66db11c.sqlite`。独立副本升级 0039/0040 并按全部 53 张业务表的旧列逐行比较，13 行一致；现用库分两次从 39 到 41 条迁移，逐行一致、完整性 ok、外键错误 0。前 39 条哈希保留，41 条哈希均匹配当前 SQL。0039 应用后未改写，额外防护用独立 0040。

升级前再次备份 `data/backups/studio-2026-11-06T04-00-42-381Z-9c28bb71.sqlite`，升级后备份 `data/backups/studio-2026-11-06T04-00-42-427Z-0d6ec185.sqlite`。独立审计输出 `test-results/light-data-audit.json`；桌面/手机截图 `test-results/light-project-desktop.png`、`light-generation-mobile.png`，均不提交。

0040 前已备份 `data/backups/studio-2026-11-06T04-07-15-028Z-74ca3f2f.sqlite`；最终审计前后备份为 `studio-2026-11-06T04-08-20-632Z-4644938b.sqlite` 与 `studio-2026-11-06T04-08-20-671Z-f00bdd84.sqlite`，同在 data/backups。最新 API 203 项含通用池路由、旧 Worker 拒绝与旧生产链，通过。

迁移在事务内暂存旧行、重建同名 Job 表并恢复索引/触发器。无需改旧 SQL、关闭外键或改名引用表；已排队实例路由入站 FK、已完成 Job/Take/媒体均以填充数据测试。候选入库单独允许同版本库状态提升，媒体身份/版本与终态输入保护不放宽到任意修改。

## 后续边界

未实现独立生成节点/执行数据连线、多输入/输出、音频生成、提示词资产、收藏/淘汰、通用素材包和真实多机验收。画布仍使用 v1 固定引用布局；新能力不冒充已交付。正式用户数据未清空，历史业务模块只冻结扩展。部署升级须构建并重启全部 Generation Worker，不能继续运行旧二进制。
