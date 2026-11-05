import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

export async function startComfyMock(files) {
  const history = new Map();
  const requests = [];
  const mock = { mode: 'normal', submissions: [], requests, history };
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
        Text: { input: { required: { text: ['STRING'] } }, output_node: false },
        ImageOutput: { output_node: true },
        VideoOutput: { output_node: true },
      };
      return send(res, Object.hasOwn(info, type) ? { [type]: info[type] } : {});
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
      const node = Object.entries(data.prompt).find(([, value]) => value.class_type.endsWith('Output'));
      const file = node[1].class_type === 'ImageOutput' ? 'image.png' : 'clip.mp4';
      const result = {
        type: 'output',
        subfolder: 'studio',
        filename: mock.mode === 'unsafe' ? '../image.png' : file,
      };
      history.set(remoteId, {
        prompt: [0, remoteId, data.prompt, data.extra_data, [node[0]]],
        status: { completed: true, status_str: 'success' },
        outputs: { [node[0]]: { [file.endsWith('png') ? 'images' : 'videos']: [result] } },
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
