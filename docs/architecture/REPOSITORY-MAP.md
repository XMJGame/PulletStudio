# 工程目录与整理规则

审计：2026-11-05，整理时基线e828d8c为82个API源文件、43个Web源文件、18个API测试文件、13个E2E文件；统计不含node_modules/dist/data。G0随后增加独立canvas-lab及tests/canvas，详见下方增量。文件数量仅供定位，不作为持续进度指标。

## 保持的工程边界

```text
PulletStudio/
├─ apps/api/
│  ├─ src/
│  │  ├─ auth/ common/ config.ts       身份、请求保护、配置
│  │  ├─ production/ scripts/          项目、层级、完整卡、原文
│  │  ├─ providers/ analysis/          文本连接、分析任务、草案人工门禁
│  │  ├─ prompt/                       Profile、编译与固定Artifact
│  │  ├─ storage/ assets/              Local、媒体、语义资产、Take审核/选片
│  │  ├─ generation/                   ComfyUI、固定工作流、媒体生成任务
│  │  ├─ timeline/                     已有可选轻量预演
│  │  ├─ exports/                      分镜与标准媒体交付
│  │  ├─ boards/                       G1正式Board、修订、固定引用及项目RBAC
│  │  ├─ db/                           实际schema、连接、备份/迁移执行
│  │  └─ *-worker.ts                   三个Worker的进程入口
│  ├─ drizzle/                        已应用的SQL、快照和journal，顺序不可改
│  └─ test/                           按业务拆分的隔离Node集成测试
├─ apps/web/src/
│  ├─ main.tsx / style.css             现有应用入口/布局/样式
│  ├─ components/                     当前工作台、表单与Dialog
│  ├─ canvas-lab/                     G0独立交互实验，不读取正式项目/资产
│  ├─ canvas/                         G1正式React Flow/来源/Inspector/冲突/历史，懒加载
│  ├─ workflows/                      工作流中心、共享GenerationSettings、只读技术图/解析
│  └─ *-types.ts / api.ts              前端类型与HTTP调用
├─ packages/contracts/                Storage接口已使用；通用Provider接口仍是草案
├─ tests/e2e/ / tests/fixtures/        浏览器业务flow、Mock及合成媒体工具
├─ tests/canvas/                      G0独立浏览器验收，另用playwright.canvas.config.ts
├─ tests/boards/                      G1真实隔离API/媒体验收，playwright.boards.config.ts
├─ tests/workflows/                   解析/边界单测与中心浏览器验收，复用隔离启动配置
├─ tools/                             setup、API监视启动、媒体校验
├─ examples/                          通用绑定样例，无本机连接配置
├─ infra/                             历史Compose示例，非可用SQLite正式部署
├─ docs/                              当前基线、决策、使用指南及下列分类
│  ├─ architecture/                   技术规格、初始审计、代码映射
│  ├─ modules/                        实施前合同及验收边界
│  ├─ operations/                     当前有效运行/验证/恢复
│  ├─ history/                        历次验收与迁移证据
│  └─ archive/                        已替代的设计/路线；旧路径保留入口
└─ data/ / test-results/ / node_modules/ / dist/  本机运行或生成内容，不入Git
```

没有独立apps/worker、provider-sdk或storage-sdk应用，旧技术图中的同名目录属于建议。Provider实际实现为providers/text-provider与generation/comfy-provider，LocalStorage实现contracts/storage-port；可插拔边界保留，但不能把草案类型当成已交付多Provider/S3。

G0新增apps/web/canvas-lab.html独立Vite入口、canvas-lab/共享模型/卡片/两底座/样式，生产main只增加导航链接；React Flow分块懒加载，未将画布依赖直接导入生产工作台。原浏览器结果改为test-results/production，画布结果为test-results/canvas，避免不同验收清空同一根目录。实验框架不直接搬到正式Board，G1保留可复用节点/模型边界并按正式数据合同接入。

## 本轮实际整理

1. 完成标准交付包并单独提交，业务与文档整理分开追溯。
2. docs/README作为导航；IMPLEMENTATION-STATUS只放当前覆盖、缺口、测试、依赖和下一门禁。
3. 原实施状态全文进入history，旧01–05进入archive并留下兼容链接；不删历史内容、不移动稳定MASTER/ADR/模块指南路径。
4. 根README更新运行与真实能力，运行细节集中到operations；根CHANGELOG记录阶段成果，不再作为现状总表。
5. 初始TEAM-V1-GAP-AUDIT明确标历史；规格正文的建议表名和旧技术示例不用于生成第二套数据模型。

## 源码暂不批量移动，按功能渐进整理

| 观察到的维护点 | 何时整理 | 边界与验证 |
|---|---|---|
| Web main.tsx约1099行，style.css约1830行 | G1需要新的工作台导航时 | 先抽AppShell/项目导航及工作台入口，再按领域移动组件；保留现页面和Dialog，E2E验证焦点/409/小屏 |
| GenerationDialog约806行，MediaDialog/AnimaticDialog约590行 | 实际更改对应业务时 | 抽配置、任务、结果等职责，不为行数拆空壳；API合同不变 |
| API schema.ts约1272行 | 有确切新增领域需要时 | 暂保留统一schema，先保持migration连续性，不能拆目录时重建数据库 |
| MediaService约773行，ProductionService约627行 | 对应功能产生稳定子领域时 | 保留公共service/权限/事务边界，逐个迁出内部职责，使用已有集成测试 |
| 一条Playwright大场景串起各flow | 新模块需要独立验收时 | 增加可复用隔离fixture与独立场景；原全链路保留，避免所有UI调试都重走初始化 |
| 通用Provider草案与实际运行合同不同 | 接第二Provider时 | 先对齐消费方/能力声明，不提前把所有服务迁到新SDK |

不移动或清理data、正式媒体、备份、密钥、已应用SQL、node_modules；不重装运行依赖。体积/保留期/安全GC另立数据生命周期任务。本轮没有删除运行文件或改变API路径，源码整理不能取代产品交付。
