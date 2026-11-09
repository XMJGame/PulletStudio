import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canExposeInput,
  suggestField,
  previewFields,
  previewParameters,
} from '../../apps/web/src/workflows/workflow-draft.ts';

test('node mapping suggestions reject internal inputs and preserve explicit scalar defaults', () => {
  for (const name of ['api_key', 'secret', 'base_url', 'file_path', 'filename', 'audio', 'video', 'image'])
    assert.equal(canExposeInput(name, 'private'), false);
  for (const value of [null, {}, ['1', 0]]) assert.equal(canExposeInput('value', value), false);
  for (const value of [Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, 'x'.repeat(4001)])
    assert.throws(() => suggestField('id', '1', 'value', value));
  for (const value of [false, 0, '', 0.4, -2.7]) {
    const field = suggestField('id', '1', 'value', value);
    const graph = { 1: { class_type: 'Input', inputs: { value, token: 'DO_NOT_EXPOSE' } } };
    const snapshot = JSON.stringify(graph);
    assert.equal(previewFields([field], graph)[0].defaultValue, value);
    assert.equal(JSON.stringify(graph), snapshot);
    assert.equal(JSON.stringify(previewFields([field], graph)).includes('DO_NOT_EXPOSE'), false);
  }
});

test('creator form preview refuses missing, private, mistyped or out of range field defaults', () => {
  const field = {
    id: 'a',
    node: '1',
    input: 'value',
    label: 'Size',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.1,
    integer: false,
  };
  for (const value of [2, '0.4', 0.45])
    assert.throws(() => previewFields([field], { 1: { class_type: 'Input', inputs: { value } } }));
  assert.throws(() => previewFields([field], {}));
  assert.throws(() =>
    previewFields([{ ...field, input: 'token' }], { 1: { class_type: 'Input', inputs: { token: 0.4 } } }),
  );
  assert.throws(() =>
    previewFields(
      [{ id: 'b', node: '1', input: 'value', label: 'Choice', type: 'enum', options: ['a', 'b'] }],
      { 1: { class_type: 'Input', inputs: { value: 'c' } } },
    ),
  );
});

test('parameter preview preserves enum defaults and validates mapped duration and seed ranges', () => {
  const graph = { 1: { class_type: 'Controls', inputs: { ratio: '16:9', seconds: 2.5, seed: 37 } } };
  const parameters = [
    {
      key: 'aspectRatio',
      node: '1',
      input: 'ratio',
      options: [
        { label: 'Wide', value: '16:9' },
        { label: 'Square', value: '1:1' },
      ],
    },
    { key: 'durationSeconds', node: '1', input: 'seconds', min: 0.5, max: 10, step: 0.5 },
    { key: 'seed', node: '1', input: 'seed', min: 0, max: 100, step: 1 },
  ];
  assert.deepEqual(
    previewParameters(parameters, graph).map((p) => p.defaultValue),
    ['16:9', 2.5, 37],
  );
  assert.throws(() => previewParameters([{ ...parameters[1], max: 1 }], graph));
  assert.throws(() =>
    previewParameters(parameters, {
      1: { class_type: 'Controls', inputs: { ratio: '4:3', seconds: 2.5, seed: 37 } },
    }),
  );
  assert.throws(() =>
    previewParameters(parameters, {
      1: { class_type: 'Controls', inputs: { ratio: '16:9', seconds: 2.5, seed: 37.5 } },
    }),
  );
});
