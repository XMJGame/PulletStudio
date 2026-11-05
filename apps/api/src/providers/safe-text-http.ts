import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  PreparedTextProvider,
  StructuredTextRequest,
  TextProvider,
  TextProviderConfig,
  TextProviderError,
} from './text-provider';

const privateAddresses = new BlockList();
const privateV6 = new BlockList();
const forbiddenV6 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  privateAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['64:ff9b::', 96],
] as const)
  privateV6.addSubnet(address, prefix, 'ipv6');
const forbiddenAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['169.254.0.0', 16],
  ['224.0.0.0', 3],
] as const)
  forbiddenAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['fe80::', 10],
  ['ff00::', 8],
  ['::ffff:0:0', 96],
  ['2002::', 16],
  ['64:ff9b::', 96],
] as const)
  forbiddenV6.addSubnet(address, prefix, 'ipv6');
forbiddenV6.addAddress('::', 'ipv6');
forbiddenAddresses.addAddress('100.100.100.200', 'ipv4');
forbiddenAddresses.addAddress('168.63.129.16', 'ipv4');
forbiddenV6.addAddress('fd00:ec2::254', 'ipv6');
export function addressAllowed(address: string, trustedPrivate: boolean) {
  const family = isIP(address);
  if (!family) return false;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  return (
    !(family === 4 ? forbiddenAddresses : forbiddenV6).check(address, type) &&
    (trustedPrivate || !(family === 4 ? privateAddresses : privateV6).check(address, type))
  );
}
export function approvedBaseUrl(input: string, trustedPrivate: boolean) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TextProviderError('ENDPOINT_INVALID', '模型端点不是有效 URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !trustedPrivate) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9._~/-]*$/.test(url.pathname)
  )
    throw new TextProviderError(
      'ENDPOINT_INVALID',
      '端点须为无凭据/查询参数的 HTTPS 基础地址；自部署 HTTP 须明确批准',
    );
  return url.toString().replace(/\/$/, '');
}
function retryDelay(value?: string | string[]) {
  if (typeof value !== 'string') return 5000;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(1000, ms) : 5000;
}
@Injectable()
export class SafeTextHttp implements TextProvider {
  async resolve(hostname: string) {
    if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }];
    let timer: NodeJS.Timeout;
    try {
      return await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TextProviderError('DNS_TIMEOUT', '模型端点解析超时')), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
  async prepare(config: TextProviderConfig): Promise<PreparedTextProvider> {
    const base = approvedBaseUrl(config.baseUrl, config.trustedPrivate);
    const url = new URL(base + '/chat/completions');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses;
    try {
      addresses = await this.resolve(hostname);
    } catch {
      throw new TextProviderError('DNS_FAILED', '模型端点解析失败，未提交请求');
    }
    if (!addresses.length || addresses.some((item) => !addressAllowed(item.address, config.trustedPrivate)))
      throw new TextProviderError('ENDPOINT_BLOCKED', '模型端点地址未获允许，未提交请求');
    const selected = addresses[0];
    return { generateStructured: (request) => this.send(url, hostname, selected, config, request) };
  }
  private async send(
    url: URL,
    hostname: string,
    address: { address: string; family: number },
    config: TextProviderConfig,
    input: StructuredTextRequest,
  ) {
    const body = JSON.stringify({
      model: config.model,
      messages: input.messages,
      stream: false,
      [config.tokenParameter]: config.maxOutputTokens,
      ...(config.outputMode === 'json_schema'
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: input.schemaName, strict: true, schema: input.schema },
            },
          }
        : config.outputMode === 'json_object'
          ? { response_format: { type: 'json_object' } }
          : {}),
    });
    const response = await new Promise<{ status: number; retryAfter?: string | string[]; bytes: Buffer }>(
      (resolve, reject) => {
        const signal = AbortSignal.timeout(config.timeoutSeconds * 1000);
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
          url,
          {
            method: 'POST',
            agent: false,
            family: address.family,
            lookup: (_host, _options, callback) => callback(null, address.address, address.family),
            servername: isIP(hostname) ? undefined : hostname,
            signal,
            maxHeaderSize: 16384,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'X-Client-Request-Id': input.traceId,
              ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            },
          },
          (incoming) => {
            const chunks: Buffer[] = [];
            let size = 0;
            incoming.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 2 * 1024 * 1024) {
                reject(new TextProviderError('PROVIDER_RESPONSE_TOO_LARGE', '模型响应超过大小限制'));
                request.destroy();
                return;
              }
              chunks.push(chunk);
            });
            incoming.on('error', () =>
              reject(
                new TextProviderError(
                  'SUBMISSION_UNCERTAIN',
                  '模型响应中断，是否完成调用需人工核实',
                  'uncertain',
                ),
              ),
            );
            incoming.on('end', () =>
              resolve({
                status: incoming.statusCode || 0,
                retryAfter: incoming.headers['retry-after'],
                bytes: Buffer.concat(chunks),
              }),
            );
          },
        );
        request.on('error', (error) =>
          reject(
            error instanceof TextProviderError
              ? error
              : new TextProviderError(
                  'SUBMISSION_UNCERTAIN',
                  '模型连接中断或超时，请核实远端调用后再决定是否重试',
                  'uncertain',
                ),
          ),
        );
        request.end(body);
      },
    );
    if (response.status >= 300 && response.status < 400)
      throw new TextProviderError('PROVIDER_REDIRECT_REJECTED', '模型端点返回重定向，已拒绝跟随');
    if (response.status === 429)
      throw new TextProviderError(
        'PROVIDER_RATE_LIMIT',
        '模型服务限流，按服务端等待时间重试',
        'retry',
        retryDelay(response.retryAfter),
      );
    if (response.status >= 500)
      throw new TextProviderError(
        'PROVIDER_SERVER_UNCERTAIN',
        '模型服务返回服务器错误，调用是否计费/执行需人工核实',
        'uncertain',
      );
    if (response.status < 200 || response.status >= 300)
      throw new TextProviderError('PROVIDER_REQUEST_REJECTED', '模型服务拒绝请求，请检查凭据、模型及参数');
    try {
      const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
      const choice = json.choices?.[0];
      if (choice?.message?.refusal)
        throw new TextProviderError('PROVIDER_REFUSAL', '模型拒绝了本次请求，请核对输入及服务规则');
      if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string')
        throw new TextProviderError('PROVIDER_INCOMPLETE', '模型输出未完整结束，请检查输出上限和兼容模式');
      let content = choice.message.content.trim();
      if (config.outputMode === 'prompt_json' && /^```(?:json)?\s*[\s\S]*\s*```$/.test(content))
        content = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      return {
        value: JSON.parse(content) as unknown,
        providerTaskId: typeof json.id === 'string' ? json.id.slice(0, 200) : null,
      };
    } catch (error) {
      if (error instanceof TextProviderError) throw error;
      throw new TextProviderError('PROVIDER_INVALID_JSON', '模型未返回有效 JSON，草案未保存');
    }
  }
}
