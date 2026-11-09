import type { BoardLayout, BoardNode } from '../../../../packages/contracts/src/board';
import type { GenerationJob } from '../components/GenerationDialog';

export function groupedResults(layout: BoardLayout, job: GenerationJob) {
  if (job.state !== 'completed' || !job.result || !job.mediaVersionId || job.selectedOutputId)
    throw new Error('任务完整产物暂不可用，请重新读取任务。');
  const outputs = [
    {
      id: job.id,
      outputId: undefined as string | undefined,
      mediaId: job.mediaVersionId,
      result: job.result,
    },
    ...(job.outputs ?? []).map((item) => ({
      id: item.id,
      outputId: item.id,
      mediaId: item.mediaVersionId,
      result: item.result,
    })),
  ];
  if (outputs.some((item) => !item.result || !item.mediaId) || outputs.length > 40)
    throw new Error('任务产物尚不完整，未添加任何节点。');
  const fresh = outputs.filter((item) => !layout.nodes.some((node) => node.id === item.id));
  if (!fresh.length) return { layout, added: 0, selected: outputs.map((item) => item.id) };
  const existingGroup = layout.nodes.find(
    (group) =>
      group.type === 'group' &&
      layout.nodes.some(
        (node) => node.parentId === group.id && node.type === 'result' && node.data.jobId === job.id,
      ) &&
      layout.nodes
        .filter((node) => node.parentId === group.id)
        .every((node) => node.type === 'result' && node.data.jobId === job.id),
  );
  if (layout.nodes.length + fresh.length + (existingGroup ? 0 : 1) > 100)
    throw new Error('画布剩余容量不足，未添加任何节点。请腾出空间或新建画布。');
  const producer = layout.nodes.find((node) => node.id === job.boardExecution?.nodeId);
  const parent = layout.nodes.find((node) => node.id === producer?.parentId);
  const groupId = existingGroup?.id ?? crypto.randomUUID();
  const children = layout.nodes.filter((node) => node.parentId === groupId);
  const cells = Array.from({ length: 40 }, (_, index) => ({
    x: 16 + (index % 8) * 194,
    y: 60 + Math.floor(index / 8) * 300,
  })).filter(
    (pos) =>
      !children.some(
        (child) =>
          pos.x < child.position.x + child.width &&
          pos.x + 180 > child.position.x &&
          pos.y < child.position.y + child.height &&
          pos.y + 280 > child.position.y,
      ),
  );
  if (cells.length < fresh.length) throw new Error('结果组空间不足，请先移出已有结果，再重试。');
  const places = cells.slice(0, fresh.length);
  const width = Math.max(existingGroup?.width ?? 0, ...places.map((pos) => pos.x + 180 + 16));
  const height = Math.max(existingGroup?.height ?? 0, ...places.map((pos) => pos.y + 280 + 20));
  if (width > 1600 || height > 1600) throw new Error('结果组空间不足，请先移出已有结果或调整分组，再重试。');
  const group: BoardNode = existingGroup
    ? { ...existingGroup, width, height, data: { ...existingGroup.data, collapsed: false } }
    : {
        id: groupId,
        type: 'group',
        width,
        height,
        position: {
          x: Math.min(45000, Math.max(-45000, (producer?.position.x ?? 0) + (parent?.position.x ?? 0) + 340)),
          y: Math.min(45000, Math.max(-45000, (producer?.position.y ?? 0) + (parent?.position.y ?? 0))),
        },
        data: { label: '生成结果', collapsed: false },
      };
  if (!existingGroup) {
    const origin = group.position;
    let placed = false;
    for (let index = 0; index <= layout.nodes.length * 4; index++) {
      const position = {
        x: Math.min(50000 - width, origin.x + (index % 2) * (width + 48)),
        y: Math.min(50000 - height, origin.y + Math.floor(index / 2) * (height + 48)),
      };
      if (
        !layout.nodes.some(
          (node) =>
            !node.parentId &&
            position.x < node.position.x + node.width &&
            position.x + width > node.position.x &&
            position.y < node.position.y + node.height &&
            position.y + height > node.position.y,
        )
      ) {
        group.position = position;
        placed = true;
        break;
      }
    }
    if (!placed) throw new Error('找不到结果组的空白位置，请整理画布或新建画布。');
  }
  const nodes: BoardNode[] = fresh.map((item, index) => ({
    id: item.id,
    type: 'result',
    parentId: groupId,
    position: places[index],
    width: 180,
    height: 280,
    data: { jobId: job.id, ...(item.outputId ? { outputId: item.outputId } : {}) },
  }));
  return {
    layout: { ...layout, nodes: [...layout.nodes.filter((node) => node.id !== groupId), group, ...nodes] },
    added: fresh.length,
    selected: [groupId],
  };
}
