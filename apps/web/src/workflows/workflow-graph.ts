export type WorkflowGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type GraphLink = { id: string; source: string; target: string; input: string; output: number };
export function readWorkflowGraph(text: string): WorkflowGraph {
  if (new TextEncoder().encode(text).byteLength > 160000) throw new Error('API工作流最多160KB。');
  const graph: unknown = JSON.parse(text.replace(/^\uFEFF/u, ''));
  if (!graph || typeof graph !== 'object' || Array.isArray(graph))
    throw new Error('请选择API格式JSON，不是ComfyUI界面布局文件。');
  const entries = Object.entries(graph);
  if (
    !entries.length ||
    entries.length > 200 ||
    entries.some(
      ([id, node]) =>
        !/^[\w:.-]{1,80}$/u.test(id) ||
        !node ||
        typeof node !== 'object' ||
        typeof node.class_type !== 'string' ||
        !node.class_type ||
        node.class_type.length > 120 ||
        !node.inputs ||
        typeof node.inputs !== 'object' ||
        Array.isArray(node.inputs),
    )
  )
    throw new Error('工作流须包含1–200个具有class_type及inputs的API节点。');
  return graph as WorkflowGraph;
}
export function isWorkflowLink(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    Number.isSafeInteger(value[1]) &&
    value[1] >= 0
  );
}
export function workflowDiagram(graph: WorkflowGraph) {
  const ids = Object.keys(graph).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  const layers = new Map(ids.map((id) => [id, 0]));
  const links: GraphLink[] = [];
  const warnings: string[] = [];
  for (const target of ids)
    for (const [input, value] of Object.entries(graph[target].inputs)) {
      if (!isWorkflowLink(value)) continue;
      if (!Object.hasOwn(graph, value[0])) {
        warnings.push(`节点 ${target} 的 ${input} 引用了缺失节点 ${value[0]}`);
        continue;
      }
      if (links.length >= 600)
        throw new Error('技术图预览最多600条连接；原JSON未被修改，可在ComfyUI核对完整图。');
      links.push({ id: `link-${links.length}`, source: value[0], target, input, output: value[1] });
      indegree.set(target, indegree.get(target)! + 1);
      outgoing.get(value[0])!.push(target);
    }
  const queue = ids.filter((id) => indegree.get(id) === 0),
    visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    visited.add(id);
    for (const target of outgoing.get(id)!) {
      layers.set(target, Math.max(layers.get(target)!, layers.get(id)! + 1));
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (visited.size !== ids.length) {
    warnings.push('存在循环或受循环阻塞的节点，请在ComfyUI核对；此处仅预览，不执行。');
    const last = Math.max(0, ...layers.values()) + 1;
    for (const id of ids) if (!visited.has(id)) layers.set(id, last);
  }
  const rows = new Map<number, number>();
  const nodes = ids.map((id) => {
    const column = layers.get(id)!,
      row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { id, classType: graph[id].class_type, position: { x: column * 290, y: row * 125 } };
  });
  return { nodes, links, warnings: warnings.slice(0, 20) };
}
