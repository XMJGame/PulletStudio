import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { groupedResults } from '../../apps/web/src/canvas/result-group.ts';
const empty = () => ({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
const job = (count = 4) => ({
  id: randomUUID(),
  state: 'completed',
  mediaVersionId: randomUUID(),
  result: { mediaType: 'image' },
  outputs: Array.from({ length: count - 1 }, () => ({
    id: randomUUID(),
    mediaVersionId: randomUUID(),
    result: { mediaType: 'image' },
  })),
});
test('forty fixed outputs fit one valid group, replay does not duplicate and capacity failure is atomic', () => {
  const source = empty(),
    j = job(40);
  const next = groupedResults(source, j);
  assert.equal(source.nodes.length, 0);
  assert.equal(next.added, 40);
  const group = next.layout.nodes.find((n) => n.type === 'group');
  assert.ok(group.width <= 1600 && group.height <= 1600);
  assert.equal(next.layout.nodes.length, 41);
  for (const child of next.layout.nodes.filter((n) => n.type === 'result')) {
    assert.equal(child.parentId, group.id);
    assert.ok(child.position.x + child.width <= group.width);
    assert.ok(child.position.y + child.height <= group.height);
    assert.equal(child.data.jobId, j.id);
  }
  assert.equal(groupedResults(next.layout, j).added, 0);
  const missing = next.layout.nodes.find((n) => n.type === 'result');
  const partial = { ...next.layout, nodes: next.layout.nodes.filter((n) => n.id !== missing.id) };
  const restored = groupedResults(partial, j);
  assert.equal(restored.added, 1);
  assert.equal(restored.layout.nodes.filter((n) => n.type === 'group').length, 1);
  assert.deepEqual(restored.layout.nodes.find((n) => n.id === missing.id).position, missing.position);
  const full = empty();
  full.nodes = Array.from({ length: 98 }, () => ({
    id: randomUUID(),
    type: 'note',
    data: { text: '' },
    position: { x: 0, y: 0 },
    width: 180,
    height: 120,
  }));
  const before = JSON.stringify(full);
  assert.throws(() => groupedResults(full, job()), /容量/);
  assert.equal(JSON.stringify(full), before);
});
test('previously placed output stays independent, incomplete jobs and selected partial views are rejected', () => {
  const j = job(),
    layout = empty();
  const first = {
    id: j.id,
    type: 'result',
    data: { jobId: j.id },
    position: { x: 900, y: 800 },
    width: 250,
    height: 280,
  };
  layout.nodes.push(first);
  const next = groupedResults(layout, j);
  assert.deepEqual(
    next.layout.nodes.find((n) => n.id === j.id),
    first,
  );
  assert.equal(next.added, 3);
  assert.equal(next.layout.nodes.filter((n) => n.parentId).length, 3);
  assert.throws(() => groupedResults(empty(), { ...j, state: 'fetching' }));
  assert.throws(() => groupedResults(empty(), { ...j, selectedOutputId: j.outputs[0].id }));
  assert.throws(() => groupedResults(empty(), { ...j, outputs: [{ ...j.outputs[0], result: null }] }));
});

test('different tasks use separate free positions without rearranging previous groups', () => {
  const first = groupedResults(empty(), job());
  const before = JSON.stringify(first.layout.nodes);
  const next = groupedResults(first.layout, job());
  const groups = next.layout.nodes.filter((n) => n.type === 'group');
  assert.equal(groups.length, 2);
  const [a, b] = groups;
  assert.ok(
    a.position.x + a.width <= b.position.x ||
      b.position.x + b.width <= a.position.x ||
      a.position.y + a.height <= b.position.y ||
      b.position.y + b.height <= a.position.y,
  );
  assert.equal(JSON.stringify(next.layout.nodes.slice(0, first.layout.nodes.length)), before);
});
