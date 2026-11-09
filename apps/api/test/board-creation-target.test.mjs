import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { saveBoardInput } from '../dist/boards/board-contract.js';

test('classified board drafts accept only known optional creation targets without granting execution', () => {
  const body = (generation) => ({ title: 'Draft', expectedRevision: 1, layout: {
    schemaVersion: 'studio.board.v1', viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{ id: randomUUID(), type: 'generation', position: { x: 0, y: 0 }, width: 250, height: 280, data: { generation } }], edges: [],
  }});
  for (const creationTarget of ['image','video','audio']) {
    const value = saveBoardInput.parse(body({ creationTarget }));
    assert.equal(value.layout.nodes[0].data.generation.creationTarget, creationTarget);
    assert.equal(value.layout.nodes[0].data.generation.workflowId, undefined);
  }
  assert.ok(saveBoardInput.safeParse(body({})).success);
  assert.equal(saveBoardInput.safeParse(body({ creationTarget: 'file' })).success, false);
  assert.equal(saveBoardInput.safeParse(body({ creationTarget: { type: 'video' } })).success, false);
  assert.equal(saveBoardInput.safeParse(body({ creationTarget: 'video', providerUrl: 'http://localhost' })).success, false);
});
