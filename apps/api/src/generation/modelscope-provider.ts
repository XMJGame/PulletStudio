import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { request } from 'node:https';
import { extname } from 'node:path';
import { z } from 'zod';
import { addressAllowed, SafeTextHttp } from '../providers/safe-text-http';
import { GenerationError } from './comfy-provider';
import { referenceImageExtensions } from './generation-contract';

export const modelScopeBase = 'https://api-inference.modelscope.cn/v1';
export const modelScopeImage = 'Qwen/Qwen-Image-2512';
const modelScopeOrigin = new URL(modelScopeBase).origin;
const taskId = z.string().regex(/^[a-z0-9_-]{1,128}$/iu);
const httpsUrl = z.string().max(8192).url();
export const modelScopeResult = z.object({ url: httpsUrl });

@Injectable()
export class ModelScopeProvider {
  constructor(private readonly network: SafeTextHttp) {}

  private async send(
    url: URL,
    signal: AbortSignal,
    headers: Record<string, string>,
    body?: string,
    timeout = 20000,
  ) {
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash)
      throw new GenerationError('MODELSCOPE_URL_BLOCKED');
    const addresses: { address: string; family: number }[] = await this.network
      .resolve(url.hostname)
      .catch(() => []);
    // The fixed official API can be routed through a local DNS proxy's synthetic
    // IP range. Node still verifies its TLS certificate for the official host.
    // Provider-supplied download URLs always require a publicly routed address.
    const officialApi = url.origin === modelScopeOrigin && Boolean(headers.Authorization);
    if (
      !addresses.length ||
      addresses.some(
        ({ address }) =>
          !addressAllowed(address, false) && !(officialApi && /^198\.(?:18|19)\./u.test(address)),
      )
    )
      throw new GenerationError('MODELSCOPE_ADDRESS_BLOCKED');
    const address = addresses[0];
    return new Promise<IncomingMessage>((resolve, reject) => {
      const outgoing = request(
        url,
        {
          method: body === undefined ? 'GET' : 'POST',
          agent: false,
          family: address.family,
          lookup: (_host, _options, callback) => callback(null, address.address, address.family),
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
          maxHeaderSize: 16384,
          headers: {
            ...headers,
            ...(body === undefined
              ? {}
              : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) }),
          },
        },
        (incoming) => {
          incoming.on('error', () => undefined);
          resolve(incoming);
        },
      );
      outgoing.on('error', () => reject(new GenerationError('MODELSCOPE_NETWORK')));
      outgoing.end(body);
    });
  }

  private async json(response: IncomingMessage) {
    try {
      const status = response.statusCode ?? 0;
      if (status === 429) throw new GenerationError('MODELSCOPE_RATE_LIMIT');
      if (status < 200 || status >= 300) {
        if ([400, 401, 403, 422].includes(status)) {
          if (status === 401) {
            const body = await this.readJson(response).catch(() => null);
            if (/bind your Alibaba Cloud account/i.test(body?.errors?.message ?? ''))
              throw new GenerationError('MODELSCOPE_ACCOUNT_BINDING_REQUIRED');
          }
          throw new GenerationError('MODELSCOPE_REQUEST_REJECTED');
        }
        throw new GenerationError('MODELSCOPE_HTTP_ERROR');
      }
      return await this.readJson(response);
    } finally {
      response.destroy();
    }
  }

  private async readJson(response: IncomingMessage) {
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for await (const chunk of response) {
        length += chunk.length;
        if (length > 256 * 1024) throw new GenerationError('MODELSCOPE_RESPONSE_INVALID');
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new GenerationError('MODELSCOPE_RESPONSE_INVALID');
    }
  }

  async submit(token: string, model: typeof modelScopeImage, prompt: string, signal: AbortSignal) {
    const response = await this.send(
      new URL(modelScopeBase + '/images/generations'),
      signal,
      { Authorization: `Bearer ${token}`, 'X-ModelScope-Async-Mode': 'true' },
      JSON.stringify({ model, prompt }),
    );
    const id = taskId.safeParse((await this.json(response))?.task_id);
    if (!id.success) throw new GenerationError('MODELSCOPE_RESPONSE_INVALID');
    return id.data;
  }

  async observe(token: string, id: string, signal: AbortSignal) {
    if (!taskId.safeParse(id).success) throw new GenerationError('MODELSCOPE_RESPONSE_INVALID');
    const response = await this.send(new URL(modelScopeBase + '/tasks/' + id), signal, {
      Authorization: `Bearer ${token}`,
      'X-ModelScope-Task-Type': 'image_generation',
    });
    const data = await this.json(response);
    if (['PENDING', 'RUNNING', 'QUEUED'].includes(data?.task_status)) return { state: 'pending' } as const;
    if (['FAILED', 'CANCELED', 'CANCELLED'].includes(data?.task_status)) return { state: 'failed' } as const;
    if (data?.task_status !== 'SUCCEED' || !Array.isArray(data.output_images))
      throw new GenerationError('MODELSCOPE_RESPONSE_INVALID');
    const result = modelScopeResult.safeParse({
      url: data.output_images[0],
    });
    if (!result.success) throw new GenerationError('MODELSCOPE_RESPONSE_INVALID');
    return { state: 'ready', result: result.data } as const;
  }

  async download(result: z.infer<typeof modelScopeResult>, limit: number, signal: AbortSignal) {
    const url = new URL(result.url);
    const body = await this.send(url, signal, {}, undefined, 60000);
    const length = Number(body.headers['content-length']);
    const mime = body.headers['content-type']?.split(';')[0].trim().toLowerCase();
    const pathExtension = extname(url.pathname).slice(1).toLowerCase();
    const extension =
      mime && Object.hasOwn(referenceImageExtensions, mime)
        ? referenceImageExtensions[mime]
        : /^(?:png|jpe?g|webp)$/u.test(pathExtension)
          ? pathExtension
          : undefined;
    if (
      body.statusCode !== 200 ||
      !extension ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > limit
    ) {
      body.destroy();
      throw new GenerationError('MODELSCOPE_DOWNLOAD_INVALID');
    }
    return { body, length, fileName: `modelscope-image.${extension}` };
  }
}
