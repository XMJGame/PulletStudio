// Domain port: no NestJS, database, HTTP routes or vendor SDK dependencies.
export type TextMessage = { role: 'system' | 'user'; content: string };
export type StructuredTextRequest = {
  messages: TextMessage[];
  schema: Record<string, unknown>;
  schemaName: string;
  traceId: string;
};
export type StructuredTextResult = { value: unknown; providerTaskId: string | null };
export interface PreparedTextProvider {
  generateStructured(request: StructuredTextRequest): Promise<StructuredTextResult>;
}
export type TextProviderConfig = {
  baseUrl: string;
  trustedPrivate: boolean;
  model: string;
  outputMode: 'json_schema' | 'json_object' | 'prompt_json';
  tokenParameter: 'max_tokens' | 'max_completion_tokens';
  maxOutputTokens: number;
  timeoutSeconds: number;
  apiKey: string | null;
};
export interface TextProvider {
  prepare(config: TextProviderConfig): Promise<PreparedTextProvider>;
}
export class TextProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public category: 'failed' | 'retry' | 'uncertain' = 'failed',
    public retryAfterMs = 0,
  ) {
    super(message);
  }
}
