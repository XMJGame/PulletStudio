import type {
  BoardLayout,
  BoardNode,
  BoardResolved,
  BoardSource,
} from '../../../../packages/contracts/src/board';

export function addLibraryMedia(
  layout: BoardLayout,
  resolved: Record<string, BoardResolved>,
  sources: BoardSource[],
  surfaceWidth: number,
) {
  if (
    sources.length > 100 ||
    sources.some(
      (source) =>
        !source.ready ||
        source.ref.kind !== 'media' ||
        source.value.status === 'unavailable' ||
        source.value.media?.id !== source.ref.id,
    )
  )
    throw new Error('部分素材已不可用，请重新选择。');
  const unique = [...new Map(sources.map((source) => [source.ref.id, source])).values()];
  const existing = new Map(
    layout.nodes.flatMap((node) => {
      const id =
        node.type === 'reference' && node.data.ref?.kind === 'media'
          ? node.data.ref.id
          : node.type === 'result'
            ? resolved[node.id]?.media?.id
            : undefined;
      return id ? [[id, node.id] as const] : [];
    }),
  );
  const fresh = unique.filter((source) => !existing.has(source.ref.id));
  if (layout.nodes.length + fresh.length > 100)
    throw new Error('画布剩余容量不足，未添加任何节点。请减少选择或新建画布。');
  const nodes: BoardNode[] = [...layout.nodes];
  const nextResolved: Record<string, BoardResolved> = {};
  const columns = Math.max(1, Math.floor(Math.max(300, surfaceWidth - 100) / (460 * layout.viewport.zoom)));
  for (const source of fresh) {
    const media = source.value.media!;
    const ratio =
      media.metadata.width && media.metadata.height ? media.metadata.width / media.metadata.height : 1;
    const width = Math.round(Math.min(420, Math.max(200, 265 * Math.sqrt(ratio))));
    const height = Math.round(Math.min(470, Math.max(185, 265 / Math.sqrt(ratio) + 64)));
    let position: BoardNode['position'] | undefined;
    for (let index = 0; index <= (layout.nodes.length + fresh.length) * 24; index++) {
      const x = Math.min(
        50000 - width,
        Math.max(-50000, (80 - layout.viewport.x) / layout.viewport.zoom + (index % columns) * 460),
      );
      const y = Math.min(
        50000 - height,
        Math.max(-50000, (40 - layout.viewport.y) / layout.viewport.zoom + Math.floor(index / columns) * 510),
      );
      if (
        !nodes.some(
          (node) =>
            !node.parentId &&
            x < node.position.x + node.width + 16 &&
            x + width + 16 > node.position.x &&
            y < node.position.y + node.height + 16 &&
            y + height + 16 > node.position.y,
        )
      ) {
        position = { x, y };
        break;
      }
    }
    if (!position) throw new Error('当前视野附近没有足够空位，未添加任何节点。请调整视图后重试。');
    const id = crypto.randomUUID();
    nodes.push({ id, type: 'reference', position, width, height, data: { ref: source.ref } });
    nextResolved[id] = source.value;
    existing.set(source.ref.id, id);
  }
  return {
    layout: fresh.length ? { ...layout, nodes } : layout,
    resolved: nextResolved,
    selected: unique.map((source) => existing.get(source.ref.id)!),
    added: fresh.length,
  };
}
