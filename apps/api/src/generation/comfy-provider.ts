import { Injectable } from '@nestjs/common';
import { request as httpRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { addressAllowed, approvedBaseUrl, SafeTextHttp } from '../providers/safe-text-http';
import {
  ResultDescriptor,
  resultDescriptor,
  WorkflowInput,
  referenceMediaFormats,
  referenceMediaExtension,
  type ReferenceMediaType,
  WorkflowParameter,
} from './generation-contract';
import { DependencyReport, fieldMatchesMetadata, inspectWorkflow } from './workflow-inspection';
import type { OutputDescriptor } from './generation-output-contract';
import {
  mediaDisconnectTargets,
  mediaInputMatchesMetadata,
  optionalMediaInputMatchesMetadata,
} from './workflow-media';

export class GenerationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
type Config = { baseUrl: string; trustedPrivate: boolean; token: string | null };
export type RemoteObservation =
  | { state: 'pending' | 'failed' }
  | { state: 'ready'; result: ResultDescriptor; outputs?: OutputDescriptor[] };
export interface MediaProvider {
  probe(signal?: AbortSignal): Promise<void>;
  queueStatus(signal?: AbortSignal): Promise<{ running: number; pending: number }>;
  validate(workflow: WorkflowInput): Promise<void>;
  inspect(workflow: WorkflowInput): Promise<DependencyReport>;
  uploadMedia(
    jobId: string,
    mime: string,
    bytes: Buffer,
    signal: AbortSignal,
    slotId?: string,
    mediaType?: ReferenceMediaType,
  ): Promise<string>;
  submit(jobId: string, graph: WorkflowInput['graph'], signal: AbortSignal): Promise<string>;
  observe(
    remoteId: string,
    jobId: string,
    workflow: WorkflowInput,
    requireMarker: boolean,
    signal: AbortSignal,
  ): Promise<RemoteObservation>;
  download(
    result: ResultDescriptor,
    limit: number,
    signal: AbortSignal,
  ): Promise<{ body: IncomingMessage; length: number }>;
}
const uuid = z.uuid();
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

@Injectable()
export class ComfyProvider {
  constructor(private readonly network: SafeTextHttp) {}
  async prepare(config: Config): Promise<MediaProvider> {
    const base = approvedBaseUrl(config.baseUrl, config.trustedPrivate);
    const hostname = new URL(base).hostname.replace(/^\[|\]$/g, '');
    const addresses = await this.network.resolve(hostname).catch(() => {
      throw new GenerationError('ENDPOINT_DNS_FAILED');
    });
    if (!addresses.length || addresses.some((item) => !addressAllowed(item.address, config.trustedPrivate)))
      throw new GenerationError('ENDPOINT_BLOCKED');
    const address = addresses[0];
    const request = (
      path: string,
      signal?: AbortSignal,
      encoded?: string | Buffer,
      timeout = 15000,
      contentType = 'application/json',
    ) =>
      new Promise<IncomingMessage>((resolve, reject) => {
        const url = new URL(base + path);
        const timer = AbortSignal.timeout(timeout);
        const outgoing = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
          url,
          {
            method: encoded === undefined ? 'GET' : 'POST',
            agent: false,
            family: address.family,
            maxHeaderSize: 16384,
            lookup: (_host, _options, callback) => callback(null, address.address, address.family),
            servername: isIP(hostname) ? undefined : hostname,
            signal: signal ? AbortSignal.any([timer, signal]) : timer,
            headers: {
              ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
              ...(encoded === undefined
                ? {}
                : { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(encoded) }),
            },
          },
          (incoming) => {
            incoming.on('error', () => undefined);
            resolve(incoming);
          },
        );
        outgoing.on('error', () => reject(new GenerationError('COMFY_CONNECTION_FAILED')));
        outgoing.end(encoded);
      });
    const readJson = async (path: string, response: IncomingMessage) => {
      try {
        const validationReply = path === '/prompt' && response.statusCode === 400;
        if (response.statusCode !== 200 && !validationReply)
          throw new GenerationError(response.statusCode === 429 ? 'COMFY_RATE_LIMIT' : 'COMFY_HTTP_ERROR');
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of response) {
          bytes += chunk.length;
          if (bytes > 4 * 1024 * 1024) throw new GenerationError('COMFY_RESPONSE_LIMIT');
          chunks.push(chunk);
        }
        const data = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (validationReply) {
          const error = object(data.error);
          throw new GenerationError(
            typeof error.type === 'string' && Object.hasOwn(data, 'node_errors')
              ? 'COMFY_REQUEST_REJECTED'
              : 'COMFY_HTTP_ERROR',
          );
        }
        return data;
      } catch (error) {
        if (error instanceof GenerationError) throw error;
        throw new GenerationError('COMFY_RESPONSE_INVALID');
      } finally {
        response.destroy();
      }
    };
    const json = async (path: string, signal?: AbortSignal, payload?: unknown) =>
      readJson(
        path,
        await request(path, signal, payload === undefined ? undefined : JSON.stringify(payload)),
      );
    return {
      async probe(signal) {
        const data = await json('/system_stats', signal);
        if (!data.system) throw new GenerationError('COMFY_RESPONSE_INVALID');
      },
      async queueStatus(signal) {
        const data = await json('/queue', signal);
        if (!Array.isArray(data.queue_running) || !Array.isArray(data.queue_pending))
          throw new GenerationError('COMFY_RESPONSE_INVALID');
        return { running: data.queue_running.length, pending: data.queue_pending.length };
      },
      async validate(workflow) {
        const cache = new Map<string, Promise<Record<string, unknown>>>();
        const node = async (id: string, signal: AbortSignal) => {
          const type = workflow.graph[id].class_type;
          if (!cache.has(type))
            cache.set(
              type,
              json(`/object_info/${encodeURIComponent(type)}`, signal).then((data) => object(data[type])),
            );
          const info = await cache.get(type)!;
          if (!Object.keys(info).length) throw new GenerationError('WORKFLOW_NODE_UNAVAILABLE');
          return info;
        };
        const signal = AbortSignal.timeout(15000);
        await Promise.all([
          ...[workflow.positive, workflow.negative]
            .filter((binding) => binding !== undefined)
            .map(async (binding) => {
              const info = await node(binding.node, signal),
                inputs = object(info.input);
              const definition =
                object(inputs.required)[binding.input] ?? object(inputs.optional)[binding.input];
              if (!Array.isArray(definition) || definition[0] !== 'STRING')
                throw new GenerationError('WORKFLOW_TEXT_BINDING_INVALID');
            }),
          node(workflow.output.node, signal).then((info) => {
            if (info.output_node !== true) throw new GenerationError('WORKFLOW_OUTPUT_NODE_INVALID');
          }),
          ...(workflow.image ? [validateImage(workflow.image)] : []),
          ...(workflow.mediaSchema?.inputs ?? []).map(async (slot) => {
            const info = await node(slot.node, signal),
              inputs = object(info.input);
            if (
              !mediaInputMatchesMetadata(
                slot.mediaType,
                object(inputs.required)[slot.input] ?? object(inputs.optional)[slot.input],
              )
            )
              throw new GenerationError('WORKFLOW_MEDIA_BINDING_INVALID');
            if (slot.onMissing === 'disconnect') {
              if (
                info.output_node === true ||
                !Array.isArray(info.output) ||
                info.output[0] !== slot.mediaType.toUpperCase()
              )
                throw new GenerationError('WORKFLOW_MEDIA_DISCONNECT_INVALID');
              await Promise.all(
                mediaDisconnectTargets(workflow.graph, slot.node).map(async (target) => {
                  const downstream = await node(target.node, signal);
                  if (!optionalMediaInputMatchesMetadata(target.input, downstream.input, slot.mediaType))
                    throw new GenerationError('WORKFLOW_MEDIA_DISCONNECT_INVALID');
                }),
              );
            }
          }),
          ...(workflow.mediaSchema?.outputs ?? []).map(async (slot) => {
            if ((await node(slot.node, signal)).output_node !== true)
              throw new GenerationError('WORKFLOW_MEDIA_BINDING_INVALID');
          }),
          ...(workflow.parameters ?? []).map(validateParameter),
          ...(workflow.fields ?? []).map(async (field) => {
            const info = await node(field.node, signal),
              inputs = object(info.input);
            if (
              !fieldMatchesMetadata(
                field,
                object(inputs.required)[field.input] ?? object(inputs.optional)[field.input],
              )
            )
              throw new GenerationError('WORKFLOW_FIELD_BINDING_INVALID');
          }),
        ]);
        async function validateParameter(binding: WorkflowParameter) {
          const info = await node(binding.node, signal);
          const inputs = object(info.input);
          const definition = object(inputs.required)[binding.input] ?? object(inputs.optional)[binding.input];
          if (!Array.isArray(definition)) throw new GenerationError('WORKFLOW_PARAMETER_BINDING_INVALID');
          const [type, constraints] = definition;
          if (binding.key === 'aspectRatio') {
            if (
              type !== 'STRING' &&
              (!Array.isArray(type) || binding.options.some((option) => !type.includes(option.value)))
            )
              throw new GenerationError('WORKFLOW_PARAMETER_BINDING_INVALID');
            return;
          }
          const range = object(constraints);
          if (
            !['INT', 'FLOAT'].includes(type) ||
            (binding.key === 'seed' && type !== 'INT') ||
            (type === 'INT' && ![binding.min, binding.max, binding.step].every(Number.isSafeInteger)) ||
            (typeof range.min === 'number' && binding.min < range.min) ||
            (typeof range.max === 'number' && binding.max > range.max)
          )
            throw new GenerationError('WORKFLOW_PARAMETER_BINDING_INVALID');
        }
        async function validateImage(binding: NonNullable<WorkflowInput['image']>) {
          const info = await node(binding.node, signal);
          const inputs = object(info.input);
          const definition = object(inputs.required)[binding.input] ?? object(inputs.optional)[binding.input];
          if (!Array.isArray(definition) || object(definition[1]).image_upload !== true)
            throw new GenerationError('WORKFLOW_IMAGE_BINDING_INVALID');
        }
      },
      async inspect(workflow) {
        return inspectWorkflow(workflow, async (type, signal) =>
          object((await json(`/object_info/${encodeURIComponent(type)}`, signal))[type]),
        );
      },
      async uploadMedia(jobId, mime, bytes, signal, slotId, mediaType = 'image') {
        const extension = referenceMediaExtension(mediaType, mime);
        if (!extension || !bytes.length || bytes.length > referenceMediaFormats[mediaType].limit)
          throw new GenerationError(
            mediaType === 'image' ? 'REFERENCE_IMAGE_INVALID' : 'REFERENCE_MEDIA_INVALID',
          );
        const subfolder = mediaType === 'image' ? 'pullet-studio' : '';
        const name = `${subfolder ? '' : 'pullet-studio-'}${uuid.parse(jobId)}${slotId ? '-' + uuid.parse(slotId) : ''}.${extension}`,
          boundary = `pullet-${randomUUID()}`;
        const field = (key: string, value: string) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
        const prefix =
          field('type', 'input') +
          field('subfolder', subfolder) +
          field('overwrite', 'false') +
          `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`;
        const multipart = Buffer.concat([Buffer.from(prefix), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
        const result = await readJson(
          '/upload/image',
          await request(
            '/upload/image',
            signal,
            multipart,
            60000,
            `multipart/form-data; boundary=${boundary}`,
          ),
        );
        if (result.name !== name || result.subfolder !== subfolder || result.type !== 'input')
          throw new GenerationError(
            mediaType === 'image' ? 'COMFY_IMAGE_UPLOAD_INVALID' : 'COMFY_MEDIA_UPLOAD_INVALID',
          );
        return subfolder ? `${subfolder}/${name}` : name;
      },
      async submit(jobId, graph, signal) {
        const data = await json('/prompt', signal, {
          prompt: graph,
          prompt_id: jobId,
          client_id: jobId,
          extra_data: { studio_job_id: jobId },
        });
        const remoteId = uuid.safeParse(data.prompt_id);
        if (!remoteId.success) throw new GenerationError('COMFY_RESPONSE_INVALID');
        return remoteId.data;
      },
      async observe(remoteId, jobId, workflow, requireMarker, signal) {
        const payload = await json(`/history/${uuid.parse(remoteId)}`, signal);
        if (!Object.hasOwn(payload, remoteId)) return { state: 'pending' };
        const row = object(payload[remoteId]),
          prompt = row.prompt;
        if (
          requireMarker &&
          (!Array.isArray(prompt) || prompt[1] !== remoteId || object(prompt[3]).studio_job_id !== jobId)
        )
          throw new GenerationError('REMOTE_JOB_UNVERIFIED');
        const status = object(row.status);
        if (status.status_str === 'error') return { state: 'failed' };
        if (status.completed !== true || status.status_str !== 'success')
          throw new GenerationError('COMFY_HISTORY_INVALID');
        const outputs = object(object(row.outputs)[workflow.output.node])[workflow.output.field];
        if (!Array.isArray(outputs) || outputs.length !== 1)
          throw new GenerationError('WORKFLOW_OUTPUT_COUNT');
        const result = resultDescriptor.safeParse(outputs[0]);
        if (!result.success) throw new GenerationError('WORKFLOW_OUTPUT_INVALID');
        const extra: OutputDescriptor[] = [];
        const seen = new Set([JSON.stringify(result.data)]);
        for (const slot of workflow.mediaSchema?.outputs ?? []) {
          const files = object(object(row.outputs)[slot.node])[slot.field];
          if (
            !Array.isArray(files) ||
            !files.length ||
            files.length > (slot.multiple ? 8 : 1) ||
            extra.length + files.length > 32
          )
            throw new GenerationError('WORKFLOW_OUTPUT_COUNT');
          for (const [index, file] of files.entries()) {
            const parsed = resultDescriptor.safeParse(file);
            if (!parsed.success || seen.has(JSON.stringify(parsed.data)))
              throw new GenerationError('WORKFLOW_OUTPUT_INVALID');
            seen.add(JSON.stringify(parsed.data));
            extra.push({
              slotId: slot.id,
              index,
              label: slot.label,
              role: slot.role,
              mediaType: slot.mediaType,
              result: parsed.data,
            });
          }
        }
        return { state: 'ready', result: result.data, ...(extra.length ? { outputs: extra } : {}) };
      },
      async download(result, limit, signal) {
        const query = new URLSearchParams({
          filename: result.filename,
          subfolder: result.subfolder,
          type: 'output',
        });
        const body = await request('/view?' + query.toString(), signal, undefined, 120000);
        const declared = body.headers['content-length'];
        const length = Number(declared);
        if (
          body.statusCode !== 200 ||
          body.headers['content-encoding'] ||
          body.headers['content-range'] ||
          !declared ||
          !/^\d+$/.test(declared) ||
          !Number.isSafeInteger(length) ||
          length < 1 ||
          length > limit
        ) {
          body.destroy();
          throw new GenerationError('COMFY_DOWNLOAD_INVALID');
        }
        return { body, length };
      },
    };
  }
}
