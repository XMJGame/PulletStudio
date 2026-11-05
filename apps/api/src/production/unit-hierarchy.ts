import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { episodes } from '../db/schema';
import { fail } from '../common/http';

export function validateParent(
  database: DatabaseService,
  projectId: string,
  workspaceId: string,
  parentId?: string | null,
  childId?: string,
) {
  const seen = new Set(childId ? [childId] : []);
  let cursor = parentId;
  while (cursor) {
    if (seen.has(cursor)) fail(400, 'UNIT_CYCLE', '制作单元不能成为自身或子孙单元的下级');
    seen.add(cursor);
    const parent = database.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.id, cursor),
          eq(episodes.projectId, projectId),
          eq(episodes.workspaceId, workspaceId),
        ),
      )
      .get();
    if (!parent || parent.unitType === 'project_root')
      fail(404, 'NOT_FOUND', '上级制作单元不存在或不属于当前项目');
    cursor = parent.parentId;
  }
}
