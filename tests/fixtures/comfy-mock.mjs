import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

export async function startComfyMock(files) {
  const history = new Map();
  const requests = [];
  const mock = { mode: 'normal', submissions: [], uploads: [], downloads: [], requests, history };
  const send = (res, data, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname);
    if (url.pathname === '/system_stats')
      return mock.mode === 'probe-down'
        ? send(res, {}, 503)
        : send(res, { system: { comfyui_version: 'fixture' } });
    if (url.pathname === '/queue') {
      await mock.beforeQueue?.();
      return send(res, mock.queue ?? { queue_running: [], queue_pending: [] });
    }
    if (url.pathname.startsWith('/object_info/')) {
      const type = decodeURIComponent(url.pathname.split('/').at(-1));
      const info = {
        Text: { input: { required: { text: ['STRING'] } }, output_node: false, output: ['CONDITIONING'] },
        ImageOutput: {
          output_node: true,
          input: {
            required: { conditioning: ['CONDITIONING'] },
            optional: {
              controls: ['CONTROL'],
              video_reference: ['VIDEO'],
              audio_reference: ['AUDIO'],
              references: [
                'COMFY_AUTOGROW_V3',
                {
                  template: { prefix: 'image_', min: 0, max: 3, input: { required: { image: ['IMAGE'] } } },
                },
              ],
            },
          },
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
        ImagesOutput: {
          output_node: true,
          input: { required: { conditioning: ['CONDITIONING'] } },
          output: [],
        },
        AudioOutput: {
          output_node: true,
          input: {
            required: { conditioning: ['CONDITIONING'] },
            optional: { video_reference: ['VIDEO'], audio_reference: ['AUDIO'] },
          },
          output: [],
        },
        LoadImage: {
          input: { required: { image: [[], { image_upload: true }] } },
          output_node: false,
          output: ['IMAGE', 'MASK'],
        },
        LoadVideo: {
          input: {
            optional: {
              video: ['STRING', { video_upload: true }],
              file: ['COMBO', { options: [], video_upload: true }],
            },
          },
          output: ['VIDEO'],
        },
        LoadAudio: {
          input: { required: { audio: ['COMBO', { options: [], audio_upload: true }] } },
          output: ['AUDIO'],
        },
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
          mime: image.type,
          bytes: Buffer.from(await image.arrayBuffer()),
          type: data.get('type'),
          subfolder: data.get('subfolder'),
          overwrite: data.get('overwrite'),
        };
        mock.uploads.push(entry);
        await mock.afterUpload?.(entry);
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
      const nodes = Object.entries(data.prompt).filter(
        ([, value]) => value.class_type.endsWith('Output') || value.class_type === 'SaveVideo',
      );
      const outputs = {};
      for (const [id, node] of nodes) {
        const names =
          node.class_type === 'ImagesOutput'
            ? ['image.jpg', 'extra.png']
            : [
                node.class_type === 'ImageOutput'
                  ? 'image.png'
                  : node.class_type === 'AudioOutput'
                    ? 'sound.mp3'
                    : 'clip.mp4',
              ];
        const field =
          node.class_type === 'AudioOutput'
            ? 'audio'
            : names[0].endsWith('png') || names[0].endsWith('jpg') || node.class_type === 'SaveVideo'
              ? 'images'
              : 'videos';
        outputs[id] = {
          [field]: names.map((filename) => ({
            type: 'output',
            subfolder: 'studio',
            filename: mock.mode === 'unsafe' ? '../image.png' : filename,
          })),
        };
      }
      history.set(remoteId, {
        prompt: [0, remoteId, data.prompt, data.extra_data, nodes.map(([id]) => id)],
        status: { completed: true, status_str: 'success' },
        outputs,
      });
      if (['lost', 'legacy-lost'].includes(mock.mode)) return req.socket.destroy();
      return send(res, { prompt_id: remoteId });
    }
    if (url.pathname.startsWith('/history/')) {
      if (mock.mode === 'hold') return send(res, {});
      const id = url.pathname.split('/').at(-1);
      const record = history.get(id);
      return send(res, record ? { [id]: record } : {});
    }
    if (url.pathname === '/view') {
      mock.downloads.push(url.searchParams.get('filename'));
      if (mock.missingFile === url.searchParams.get('filename')) return send(res, {}, 503);
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

export function fixtureReferenceImages(connectionId) {
  const workflow = fixtureWorkflow(connectionId);
  for (const node of ['6', '7'])
    workflow.graph[node] = { class_type: 'LoadImage', inputs: { image: 'local-placeholder.png' } };
  return {
    ...workflow,
    name: 'Two reference images',
    mediaSchema: {
      version: 'studio.workflow-media.v1',
      inputs: ['6', '7'].map((node, index) => ({
        id: randomUUID(),
        label: ['Character', 'Scene'][index],
        mediaType: 'image',
        role: 'reference',
        node,
        input: 'image',
        required: true,
        onMissing: 'error',
      })),
      outputs: [],
    },
  };
}

export function fixtureOptionalImages(connectionId) {
  const workflow = fixtureReferenceImages(connectionId);
  workflow.name = 'Optional reference images';
  workflow.graph[workflow.output.node].inputs['references.image_0'] = ['6', 0];
  workflow.graph[workflow.output.node].inputs['references.image_1'] = ['7', 0];
  Object.assign(workflow.mediaSchema.inputs[1], { required: false, onMissing: 'disconnect' });
  return workflow;
}

export function fixtureRequiredMedia(connectionId) {
  const workflow = fixtureMediaSchema(connectionId);
  workflow.name = 'Image video audio references';
  workflow.mediaSchema.outputs = [];
  const video = workflow.mediaSchema.inputs[1];
  Object.assign(video, { input: 'file', required: true, onMissing: 'error' });
  workflow.graph['7'].inputs = { file: 'private-reference.mp4' };
  Object.assign(workflow.graph[workflow.output.node].inputs, {
    'references.image_0': ['6', 0],
    video_reference: ['7', 0],
    audio_reference: ['8', 0],
  });
  delete workflow.graph['9'];
  return workflow;
}

export function fixtureOptionalMedia(connectionId, audioOutput = false) {
  const workflow = fixtureRequiredMedia(connectionId);
  workflow.name = audioOutput ? 'Audio with optional references' : 'Optional video and audio';
  workflow.mediaSchema.inputs.shift();
  delete workflow.graph['6'];
  delete workflow.graph[workflow.output.node].inputs['references.image_0'];
  for (const slot of workflow.mediaSchema.inputs)
    Object.assign(slot, { role: 'reference', required: false, onMissing: 'disconnect' });
  if (audioOutput) {
    workflow.capability = 'audio.music';
    workflow.graph[workflow.output.node].class_type = 'AudioOutput';
    workflow.output.field = 'audio';
  }
  return workflow;
}

export function fixtureMediaSchema(connectionId) {
  const workflow = fixtureWorkflow(connectionId);
  return {
    ...workflow,
    name: 'Declared media study',
    graph: {
      ...workflow.graph,
      6: { class_type: 'LoadImage', inputs: { image: 'private-reference.png' } },
      7: { class_type: 'LoadVideo', inputs: { video: 'private-reference.mp4' } },
      8: { class_type: 'LoadAudio', inputs: { audio: 'private-reference.wav' } },
      9: { class_type: 'ImageOutput', inputs: { conditioning: ['1', 0] } },
    },
    mediaSchema: {
      version: 'studio.workflow-media.v1',
      inputs: [
        {
          id: randomUUID(),
          label: 'Character reference',
          mediaType: 'image',
          role: 'reference',
          node: '6',
          input: 'image',
          required: true,
          onMissing: 'error',
        },
        {
          id: randomUUID(),
          label: 'Motion reference',
          mediaType: 'video',
          role: 'reference',
          node: '7',
          input: 'video',
          required: false,
          onMissing: 'empty',
        },
        {
          id: randomUUID(),
          label: 'Sound reference',
          mediaType: 'audio',
          role: 'source',
          node: '8',
          input: 'audio',
          required: true,
          onMissing: 'error',
        },
      ],
      outputs: [
        {
          id: randomUUID(),
          label: 'Preview image',
          mediaType: 'image',
          role: 'preview',
          node: '9',
          field: 'images',
          multiple: false,
        },
      ],
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

export function fixtureExtendedOutputs(connectionId) {
  const workflow = fixtureWorkflow(connectionId, true);
  workflow.name = 'Video with storyboard and sound';
  workflow.graph['8'] = { class_type: 'ImagesOutput', inputs: { conditioning: ['1', 0] } };
  workflow.graph['9'] = { class_type: 'AudioOutput', inputs: { conditioning: ['1', 0] } };
  workflow.mediaSchema = {
    version: 'studio.workflow-media.v1',
    inputs: [],
    outputs: [
      {
        id: randomUUID(),
        label: 'Storyboard',
        role: 'preview',
        mediaType: 'image',
        node: '8',
        field: 'images',
        multiple: true,
      },
      {
        id: randomUUID(),
        label: 'Music',
        role: 'intermediate',
        mediaType: 'audio',
        node: '9',
        field: 'audio',
        multiple: false,
      },
    ],
  };
  return workflow;
}
