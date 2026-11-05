import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function mockDraft(input, invalidSource = false) {
  return {
    title: 'Mock storyboard draft',
    summary: 'Isolated fixture output; no real model was called.',
    shots: [
      {
        title: 'Arrival at the platform',
        intent: 'Introduce the location',
        description: 'A traveler waits beside an empty platform.',
        framing: 'Wide shot',
        angle: 'Eye level',
        composition: 'Subject to the side',
        cameraMovement: 'Slow push',
        action: 'The traveler looks toward the tracks',
        lighting: 'Soft daylight',
        mood: 'Expectant',
        dialogue: '',
        audioNotes: 'Voice timing is not measured',
        durationSeconds: null,
        technique: 'image_to_video',
        assets: ['Traveler', 'Platform'],
        riskNotes: ['Review continuity and timing'],
        sourceSpanIds: [
          invalidSource ? 'f'.repeat(64) : input.chunk.blocks.find((block) => block.text.trim()).id,
        ],
      },
    ],
  };
}
export async function startTextMock(port = 0) {
  const requests = [];
  const counts = new Map();
  const pending = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.end('mock');
      return;
    }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 200000) {
        res.writeHead(413);
        res.end();
        return;
      }
    }
    const parsed = JSON.parse(body);
    const input = JSON.parse(parsed.messages.find((message) => message.role === 'user').content);
    requests.push({ body: parsed, authorization: req.headers.authorization });
    const count = (counts.get(parsed.model) || 0) + 1;
    counts.set(parsed.model, count);
    const respond = () => {
      if (parsed.model === 'rate_limit' && count === 1) {
        res.writeHead(429, { 'Retry-After': '60' });
        res.end('fixture-secret-error-body');
        return;
      }
      if (parsed.model === 'server_error') {
        res.writeHead(503);
        res.end('fixture-secret-error-body');
        return;
      }
      if (parsed.model === 'disconnect') {
        req.socket.destroy();
        return;
      }
      let value = mockDraft(input, parsed.model === 'invalid_source');
      if (parsed.model === 'two_shots') value.shots.push({ ...value.shots[0], title: 'Second fixture shot' });
      if (parsed.model === 'invalid_schema') value = { unexpected: 'fixture' };
      const content = parsed.model === 'invalid_json' ? '{invalid' : JSON.stringify(value);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `mock-${requests.length}`,
          choices: [{ message: { content }, finish_reason: 'stop' }],
        }),
      );
    };
    if (parsed.model === 'hold') pending.push(respond);
    else respond();
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    server,
    requests,
    pending,
    counts,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    async close() {
      for (const release of pending.splice(0)) release();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  startTextMock(Number(process.env.TEXT_MOCK_PORT || 3118)).then(() =>
    console.log('Isolated text mock ready'),
  );
}
