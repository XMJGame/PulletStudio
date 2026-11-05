import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

test('provider credentials are authenticated and bound to their connection scope', async () => {
  const { ProviderSecrets } = await import('../dist/providers/provider-secrets.js');
  const vault = new ProviderSecrets({ providerMasterKey: 'a'.repeat(64) });
  const first = vault.encrypt('fixture-secret', 'connection', 'workspace');
  const second = vault.encrypt('fixture-secret', 'connection', 'workspace');
  assert.notEqual(first, second); assert.ok(!first.includes('fixture-secret'));
  assert.equal(vault.decrypt(first, 'connection', 'workspace'), 'fixture-secret');
  assert.throws(() => vault.decrypt(first, 'other', 'workspace'));
  assert.throws(() => new ProviderSecrets({ providerMasterKey: 'b'.repeat(64) }).decrypt(first, 'connection', 'workspace'));
  assert.throws(() => new ProviderSecrets({ providerMasterKey: '' }).encrypt('secret', 'connection', 'workspace'));
});

test('text transport blocks unsafe addresses, pins DNS and does not follow redirects', async () => {
  const { SafeTextHttp, addressAllowed, approvedBaseUrl } = await import('../dist/providers/safe-text-http.js');
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '2002:7f00:1::']) assert.equal(addressAllowed(address, false), false, address);
  for (const address of ['169.254.169.254', 'fe80::1', '0.0.0.0', '::', '::ffff:a9fe:a9fe', '100.100.100.200', 'fd00:ec2::254']) assert.equal(addressAllowed(address, true), false, address);
  assert.equal(addressAllowed('127.0.0.1', true), true);
  assert.equal(addressAllowed('8.8.8.8', false), true);
  for (const url of ['file:///tmp/secret', 'https://user:secret@public.example/v1', 'https://public.example/v1?key=secret', 'http://public.example/v1']) assert.throws(() => approvedBaseUrl(url, false));
  let hits = 0, redirected = 0;
  const server = createServer((req, res) => { hits++; if (req.url.startsWith('/slow/')) { req.resume(); return; } res.writeHead(307, { Location: '/elsewhere' }); res.end(); if (req.url === '/elsewhere') redirected++; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1`;
    const transport = new SafeTextHttp();
    await assert.rejects(() => transport.prepare({ baseUrl: url, trustedPrivate: false }), /HTTP/);
    const provider = await transport.prepare({ baseUrl: url, trustedPrivate: true, model: 'test-model', outputMode: 'json_object', tokenParameter: 'max_tokens', maxOutputTokens: 100, timeoutSeconds: 2, apiKey: null });
    await assert.rejects(() => provider.generateStructured({ messages: [], schema: {}, schemaName: 'test', traceId: 'test' }), error => error.code === 'PROVIDER_REDIRECT_REJECTED');
    assert.equal(hits, 1); assert.equal(redirected, 0);
    const rebound = new SafeTextHttp(); rebound.resolve = async () => [{ address: '127.0.0.1', family: 4 }];
    await assert.rejects(() => rebound.prepare({ baseUrl: 'https://public.example/v1', trustedPrivate: false }), error => error.code === 'ENDPOINT_BLOCKED');
    const pinned = new SafeTextHttp(); let lookups = 0;
    pinned.resolve = async () => { lookups++; if (lookups > 1) throw Error('rebound DNS'); return [{ address: '127.0.0.1', family: 4 }]; };
    const local = await pinned.prepare({ baseUrl: `http://pinned.example:${server.address().port}/v1`, trustedPrivate: true, model: 'test-model', outputMode: 'prompt_json', tokenParameter: 'max_tokens', maxOutputTokens: 100, timeoutSeconds: 2, apiKey: null });
    await assert.rejects(() => local.generateStructured({ messages: [], schema: {}, schemaName: 'test', traceId: 'test' }), error => error.code === 'PROVIDER_REDIRECT_REJECTED');
    assert.equal(lookups, 1);
    const slow = await transport.prepare({ baseUrl: `http://127.0.0.1:${server.address().port}/slow`, trustedPrivate: true, model: 'fixture', outputMode: 'json_object', tokenParameter: 'max_tokens', maxOutputTokens: 100, timeoutSeconds: 0.03, apiKey: null });
    await assert.rejects(() => slow.generateStructured({ messages: [], schema: {}, schemaName: 'fixture', traceId: 'fixture' }), error => error.category === 'uncertain');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
