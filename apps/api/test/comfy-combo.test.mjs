import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import 'reflect-metadata';
import { ComfyProvider } from '../dist/generation/comfy-provider.js';
import { SafeTextHttp } from '../dist/providers/safe-text-http.js';
import { fieldMatchesMetadata, inspectWorkflow } from '../dist/generation/workflow-inspection.js';

test('legacy and COMBO options validate aspect ratios and creator enums without accepting unknown values', async () => {
  let modern = true,
    malformed = false;
  const declaration = (options) =>
    modern ? ['COMBO', { options: malformed ? undefined : options }] : [options];
  const defs = () => ({
    Text: { input: { required: { text: ['STRING'] } }, output: ['STRING'] },
    SaveImage: { input: { required: {} }, output: [], output_node: true },
    Ratio: { input: { required: { ratio: declaration(['square', 'wide']) } }, output: [] },
    Quality: { input: { required: { quality: declaration(['draft', 'high']) } }, output: [] },
  });
  const server = createServer((req, res) => {
    const type = decodeURIComponent(req.url.split('/').at(-1));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ [type]: defs()[type] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const workflow = {
    name: 'Enum schema fixture',
    connectionId: '00000000-0000-4000-8000-000000000001',
    capability: 'image.text_to_image',
    graph: {
      1: { class_type: 'Text', inputs: { text: 'prompt' } },
      2: { class_type: 'SaveImage', inputs: {} },
      3: { class_type: 'Ratio', inputs: { ratio: 'square' } },
      4: { class_type: 'Quality', inputs: { quality: 'draft' } },
    },
    positive: { node: '1', input: 'text' },
    output: { node: '2', field: 'images' },
    parameters: [
      {
        key: 'aspectRatio',
        node: '3',
        input: 'ratio',
        options: [
          { label: 'Square', value: 'square' },
          { label: 'Wide', value: 'wide' },
        ],
      },
    ],
    fields: [
      {
        id: '00000000-0000-4000-8000-000000000002',
        label: 'Quality',
        node: '4',
        input: 'quality',
        type: 'enum',
        options: ['draft', 'high'],
      },
    ],
  };
  try {
    const provider = await new ComfyProvider(new SafeTextHttp()).prepare({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      trustedPrivate: true,
      token: '',
    });
    for (const next of [false, true]) {
      modern = next;
      await provider.validate(workflow);
      assert.equal((await provider.inspect(workflow)).status, 'compatible');
      const bad = structuredClone(workflow);
      bad.parameters[0].options[1].value = 'missing';
      await assert.rejects(
        () => provider.validate(bad),
        (e) => e.code === 'WORKFLOW_PARAMETER_BINDING_INVALID',
      );
      const wrong = structuredClone(workflow);
      wrong.fields[0].options.push('missing');
      await assert.rejects(
        () => provider.validate(wrong),
        (e) => e.code === 'WORKFLOW_FIELD_BINDING_INVALID',
      );
      const badConstant = structuredClone(workflow);
      badConstant.graph['3'].inputs.ratio = 'missing';
      const report = await inspectWorkflow(badConstant, async (type) => defs()[type]);
      assert.equal(report.status, 'incompatible');
      assert.ok(report.nodes.find((n) => n.id === '3').issues.some((i) => i.code === 'OPTION_UNAVAILABLE'));
    }
    malformed = true;
    await assert.rejects(
      () => provider.validate(workflow),
      (e) => ['WORKFLOW_PARAMETER_BINDING_INVALID', 'WORKFLOW_FIELD_BINDING_INVALID'].includes(e.code),
    );
    assert.equal(
      fieldMatchesMetadata(workflow.fields[0], ['COMBO', { options: ['draft', 'high'], image_upload: true }]),
      false,
    );
    assert.equal(
      fieldMatchesMetadata(workflow.fields[0], ['COMBO', { options: [{ value: 'draft' }] }]),
      false,
    );
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
