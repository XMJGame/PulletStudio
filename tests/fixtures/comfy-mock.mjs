import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

export async function startComfyMock(files) {
  const history = new Map();
  const requests = [];
  const mock = { mode: 'normal', submissions: [], uploads: [], requests, history };
  const send = (res, data, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    if (url.pathname === '/system_stats') return send(res, { system: { comfyui_version: 'fixture' } });
    if (url.pathname.startsWith('/object_info/')) {
      const type = decodeURIComponent(url.pathname.split('/').at(-1));
      const info = {
        Text: { input: { required: { text: ['STRING'] } }, output_node: false, output: ['CONDITIONING'] },
        ImageOutput: {
          output_node: true,
          input: { required: { conditioning: ['CONDITIONING'] }, optional: { controls: ['CONTROL'] } },
          output: [],
        },
        CreativeControls: {
          input: {
            required: {
              note: ['STRING'],
              iterations: ['INT', { min: 1, max: 20 }],
              enabled: ['BOOLEAN'],
              quality: [['draft', 'high']],
            },
          },
          output: ['CONTROL'],
        },
        CheckpointLoaderSimple: {
          input: { required: { ckpt_name: [['fixture.safetensors']] } },
          output: ['MODEL'],
        },
        VideoOutput: { output_node: true },
        SaveVideo: { output_node: true },
        LoadImage: { input: { required: { image: [[], { image_upload: true }] } }, output_node: false },
        'Custom Input': {
          input: { optional: { 'source.file': ['STRING', { image_upload: true }] } },
          output_node: false,
        },
        'Plain Filename': { input: { required: { 'source.file': ['STRING'] } }, output_node: false },
        AspectInput: { input: { required: { aspect_ratio: [['1:1 (Square)', '16:9 (Landscape)']] } } },
        SecondsInput: { input: { required: { value: ['FLOAT', { min: 0.5, max: 30 }] } } },
        SeedInput: { input: { required: { noise_seed: ['INT', { min: 0, max: 4294967295 }] } } },
      };
      const override = mock.objectInfoOverrides;
      const definition = override && Object.hasOwn(override, type) ? override[type] : info[type];
      return send(res, definition ? { [type]: definition } : {});
    }
    if (req.method === 'POST' && url.pathname === '/upload/image') {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const data = await new Response(Buffer.concat(chunks), {
          headers: { 'content-type': req.headers['content-type'] },
        }).formData();
        const image = data.get('image');
        const entry = {
          name: image.name,
          bytes: Buffer.from(await image.arrayBuffer()),
          type: data.get('type'),
          subfolder: data.get('subfolder'),
          overwrite: data.get('overwrite'),
        };
        mock.uploads.push(entry);
        return send(res, {
          name: mock.mode === 'unsafe-upload' ? '../wrong.png' : entry.name,
          subfolder: entry.subfolder,
          type: entry.type,
        });
      } catch {
        return send(res, {}, 400);
      }
    }
    if (req.method === 'POST' && url.pathname === '/prompt') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      mock.submissions.push(data);
      if (mock.mode === 'reject')
        return send(res, { error: { type: 'prompt_outputs_failed_validation' }, node_errors: {} }, 400);
      if (mock.mode === 'server-error') return send(res, {}, 503);
      const remoteId = mock.mode === 'legacy-lost' ? randomUUID() : data.prompt_id;
      const node = Object.entries(data.prompt).find(
        ([, value]) => value.class_type.endsWith('Output') || value.class_type === 'SaveVideo',
      );
      const file = node[1].class_type === 'ImageOutput' ? 'image.png' : 'clip.mp4';
      const result = {
        type: 'output',
        subfolder: 'studio',
        filename: mock.mode === 'unsafe' ? '../image.png' : file,
      };
      history.set(remoteId, {
        prompt: [0, remoteId, data.prompt, data.extra_data, [node[0]]],
        status: { completed: true, status_str: 'success' },
        outputs: {
          [node[0]]: {
            [file.endsWith('png') || node[1].class_type === 'SaveVideo' ? 'images' : 'videos']: [result],
          },
        },
      });
      if (['lost', 'legacy-lost'].includes(mock.mode)) return req.socket.destroy();
      return send(res, { prompt_id: remoteId });
    }
    if (url.pathname.startsWith('/history/')) {
      const id = url.pathname.split('/').at(-1);
      const record = history.get(id);
      return send(res, record ? { [id]: record } : {});
    }
    if (url.pathname === '/view') {
      const file = files[url.searchParams.get('filename')];
      if (
        !file ||
        url.searchParams.get('type') !== 'output' ||
        url.searchParams.get('subfolder') !== 'studio'
      )
        return send(res, {}, 404);
      res.writeHead(200, { 'content-length': file.length, 'content-type': 'application/octet-stream' });
      return res.end(file);
    }
    return send(res, {}, 404);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    ...mock,
    mock,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function fixtureWorkflow(connectionId, video = false) {
  return {
    name: video ? 'Mock video' : 'Mock image',
    connectionId,
    capability: video ? 'video.text_to_video' : 'image.text_to_image',
    graph: {
      1: { class_type: 'Text', inputs: { text: 'replace positive' } },
      2: { class_type: 'Text', inputs: { text: 'replace negative' } },
      3: { class_type: video ? 'VideoOutput' : 'ImageOutput', inputs: { conditioning: ['1', 0] } },
    },
    positive: { node: '1', input: 'text' },
    negative: { node: '2', input: 'text' },
    output: { node: '3', field: video ? 'videos' : 'images' },
  };
}

export function fixtureCreativeFields(connectionId) {
  const workflow = fixtureWorkflow(connectionId);
  workflow.name = 'Creative fields fixture';
  workflow.graph['5'] = {
    class_type: 'CreativeControls',
    inputs: { note: 'Studio reference', iterations: 4, enabled: true, quality: 'draft' },
  };
  workflow.graph['3'].inputs.controls = ['5', 0];
  workflow.fields = [
    { id: randomUUID(), label: '补充描述', node: '5', input: 'note', type: 'text', maxLength: 100 },
    {
      id: randomUUID(),
      label: '迭代次数',
      node: '5',
      input: 'iterations',
      type: 'number',
      integer: true,
      min: 1,
      max: 20,
      step: 1,
    },
    { id: randomUUID(), label: '细节增强', node: '5', input: 'enabled', type: 'boolean' },
    {
      id: randomUUID(),
      label: '质量档位',
      node: '5',
      input: 'quality',
      type: 'enum',
      options: ['draft', 'high'],
    },
  ];
  workflow.fieldSchemaVersion = 'studio.workflow-fields.v1';
  return workflow;
}
export function fixtureI2V(connectionId) {
  const workflow = fixtureWorkflow(connectionId, true);
  return {
    ...workflow,
    name: 'Mock image to video',
    capability: 'video.image_to_video',
    image: { node: '4', input: 'image' },
    output: { node: '3', field: 'images' },
    graph: {
      ...workflow.graph,
      3: { class_type: 'SaveVideo', inputs: { video: ['5', 0] } },
      4: { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } },
      5: { class_type: 'ImageToVideo', inputs: { first_frame: ['4', 0], prompt: ['1', 0] } },
    },
  };
}

export function fixtureParameterized(connectionId) {
  const workflow = fixtureWorkflow(connectionId, true);
  return {
    ...workflow,
    name: 'Configurable video',
    graph: {
      ...workflow.graph,
      6: { class_type: 'AspectInput', inputs: { aspect_ratio: '1:1 (Square)' } },
      7: { class_type: 'SecondsInput', inputs: { value: 2.5 } },
      8: { class_type: 'SeedInput', inputs: { noise_seed: 37 } },
      9: { class_type: 'FrameExpression', inputs: { seconds: ['7', 0], expression: 'round(a * 24)' } },
    },
    parameters: [
      {
        key: 'aspectRatio',
        node: '6',
        input: 'aspect_ratio',
        options: [
          { label: '方形', value: '1:1 (Square)' },
          { label: '横屏', value: '16:9 (Landscape)' },
        ],
      },
      { key: 'durationSeconds', node: '7', input: 'value', min: 0.5, max: 30, step: 0.5 },
      { key: 'seed', node: '8', input: 'noise_seed', min: 0, max: 4294967295, step: 1 },
    ],
  };
}
