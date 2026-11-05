# ADR-001：保留现有主技术栈

状态：采用。2026-11-04。依据 MASTER-PLAN §0 的已有成果保护条款及用户本轮明确指令。

现有 NestJS 已实现认证、租户授权、编号、乐观锁、历史剧本、回收站与成员管理，32 项接口测试通过，并非旧 ZIP 空壳。主后端继续 NestJS/TypeScript；Web 保留 React/Vite 和当前组件/CSS；结构化校验用现有 Zod；迁移继续 Drizzle。Python/FastAPI/Pydantic/Alembic 示例转换为等价能力，不建立第二套主后端。

沿用现有 scrypt-v1 密码哈希与 8–16 位新密码规则，不重置或重新散列用户凭据。Argon2id 属后续兼容升级事项，可逐账户登录时迁移，不能破坏旧登录。此决策不声称已实现 Argon2id。

成本：暂不引入 Tailwind/shadcn/Tiptap/TanStack 等未使用库；有实际需求再增量评估，不为满足依赖名称改写已可用功能。未来换框架必须另列迁移、兼容、回滚成本并获确认。
