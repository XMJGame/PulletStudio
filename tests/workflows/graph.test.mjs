import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readWorkflowGraph,
  workflowDiagram,
  isWorkflowLink,
} from '../../apps/web/src/workflows/workflow-graph.ts';
test('API graph parsing is bounded, accepts BOM and rejects UI exports and incomplete shapes', () => {
  const graph = { 1: { class_type: 'Text', inputs: { text: '中文创作内容' } } };
  assert.deepEqual(readWorkflowGraph('\uFEFF' + JSON.stringify(graph)), graph);
  for (const value of [
    {},
    [],
    { nodes: [], links: [] },
    { 1: { class_type: 'Text', inputs: [] } },
    Object.fromEntries(Array.from({ length: 201 }, (_, index) => [index, graph[1]])),
  ])
    assert.throws(() => readWorkflowGraph(JSON.stringify(value)));
  assert.throws(
    () =>
      readWorkflowGraph(JSON.stringify({ 1: { class_type: 'Text', inputs: { text: '中'.repeat(55000) } } })),
    /160KB/,
  );
});
test('deterministic diagram derives directed links without changing original constants or graph', () => {
  const graph = readWorkflowGraph(
    JSON.stringify({
      3: { class_type: 'Save', inputs: { image: ['2', 0], prompt: ['1', 1] } },
      2: { class_type: 'Render', inputs: { conditioning: ['1', 0], literal: [128, 256] } },
      1: { class_type: 'Text', inputs: { text: 'https://not-a-media-request.invalid' } },
    }),
  );
  const before = JSON.stringify(graph),
    result = workflowDiagram(graph);
  assert.equal(result.links.length, 3);
  assert.deepEqual(result.warnings, []);
  assert.ok(
    result.nodes.find((node) => node.id === '3').position.x >
      result.nodes.find((node) => node.id === '2').position.x,
  );
  assert.deepEqual(result, workflowDiagram(graph));
  assert.equal(JSON.stringify(graph), before);
  assert.equal(isWorkflowLink(['1', -1]), false);
  assert.equal(isWorkflowLink(['1', 0]), true);
  assert.equal(isWorkflowLink([128, 256]), false);
});
test('cycles and missing nodes produce explicit warnings without recursive traversal or invented edges', () => {
  const graph = {
    a: { class_type: 'A', inputs: { input: ['b', 0] } },
    b: { class_type: 'B', inputs: { input: ['a', 0], missing: ['unknown', 0] } },
  };
  const result = workflowDiagram(graph);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.links.length, 2);
  assert.ok(result.warnings.some((text) => text.includes('循环')));
  assert.ok(result.warnings.some((text) => text.includes('缺失节点')));
});
test('preview edge limit prevents unbounded SVG work and special node keys use own properties', () => {
  const graph = readWorkflowGraph(
    '{"__proto__":{"class_type":"Source","inputs":{}},"target":{"class_type":"Output","inputs":{"source":["__proto__",0]}}}',
  );
  assert.equal(workflowDiagram(graph).links.length, 1);
  assert.equal({}.class_type, undefined);
  const large = {
    a: { class_type: 'A', inputs: {} },
    b: {
      class_type: 'B',
      inputs: Object.fromEntries(Array.from({ length: 601 }, (_, index) => [`in${index}`, ['a', index]])),
    },
  };
  assert.throws(() => workflowDiagram(large), /600/);
});
