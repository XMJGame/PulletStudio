import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { addLibraryMedia } from '../../apps/web/src/canvas/add-library-media.ts';
const empty = () => ({
  schemaVersion: 'studio.board.v1',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
});
const source = (id = randomUUID()) => ({
  ref: { kind: 'media', id },
  ready: true,
  value: {
    title: 'Reference',
    status: 'current',
    media: { id, mediaType: 'image', metadata: { width: 960, height: 540 } },
  },
});
test('fixed media and result duplicates focus existing nodes without changing the layout', () => {
  const a = source(),
    b = source(),
    layout = empty();
  const first = addLibraryMedia(layout, {}, [a, b, a], 1000);
  assert.equal(first.added, 2);
  assert.equal(layout.nodes.length, 0);
  first.layout.nodes[1] = { ...first.layout.nodes[1], type: 'result', data: { jobId: randomUUID() } };
  const again = addLibraryMedia(first.layout, first.resolved, [a, b], 1000);
  assert.equal(again.added, 0);
  assert.equal(again.layout, first.layout);
  assert.deepEqual(again.selected, first.selected);
});
test('capacity and unavailable selection failures preserve every original node', () => {
  const layout = empty();
  layout.nodes = Array.from({ length: 99 }, () => ({
    id: randomUUID(),
    type: 'note',
    data: { text: '' },
    position: { x: 0, y: 0 },
    width: 250,
    height: 280,
  }));
  const before = structuredClone(layout);
  assert.throws(() => addLibraryMedia(layout, {}, [source(), source()], 1000), /容量不足/);
  assert.throws(() => addLibraryMedia(layout, {}, [{ ...source(), ready: false }], 1000), /不可用/);
  assert.deepEqual(layout, before);
});
test('batch placement avoids existing groups and stays inside world bounds at zoomed viewports', () => {
  const layout = empty();
  layout.viewport = { x: -120, y: 50, zoom: 0.5 };
  layout.nodes.push({
    id: randomUUID(),
    type: 'group',
    data: { label: 'Keep', collapsed: false },
    position: { x: 0, y: 0 },
    width: 1600,
    height: 1600,
  });
  const next = addLibraryMedia(
    layout,
    {},
    Array.from({ length: 12 }, () => source()),
    1100,
  );
  assert.equal(next.added, 12);
  for (const [index, node] of next.layout.nodes.entries()) {
    assert.ok(node.position.x >= -50000 && node.position.x + node.width <= 50000);
    assert.ok(node.position.y >= -50000 && node.position.y + node.height <= 50000);
    for (const other of next.layout.nodes.slice(index + 1))
      assert.ok(
        node.position.x + node.width <= other.position.x ||
          other.position.x + other.width <= node.position.x ||
          node.position.y + node.height <= other.position.y ||
          other.position.y + other.height <= node.position.y,
      );
  }
  const edge = { ...empty(), viewport: { x: -50000, y: -50000, zoom: 0.15 } };
  assert.throws(() => addLibraryMedia(edge, {}, [source(), source()], 1000), /没有足够空位/);
  assert.equal(edge.nodes.length, 0);
});
