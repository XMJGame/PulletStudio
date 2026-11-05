/** Design-time interface only. No provider implementations are included in M0. */
export type GenerationCapability =
  | 'image.text_to_image'
  | 'image.image_to_image'
  | 'video.text_to_video'
  | 'video.image_to_video'
  | 'audio.speech'
  | 'audio.music'
  | 'text.chat';

export type JobState =
  | 'queued' | 'preparing' | 'submitted' | 'running'
  | 'succeeded' | 'failed' | 'cancel_requested' | 'canceled' | 'unknown';

export interface GenerationRequest {
  workspaceId: string;
  projectId: string;
  shotId?: string;
  modelProfileId: string;
  capability: GenerationCapability;
  prompt?: string;
  inputAssetIds: string[];
  options: Record<string, unknown>;
  idempotencyKey: string;
}

export interface ProviderJobRef { providerTaskId: string; }
export interface ProviderJobStatus { state: JobState; progress?: number; errorCode?: string; }
export interface ResultDescriptor {
  kind: 'provider_object' | 'trusted_url' | 'stream';
  mediaType: 'image' | 'video' | 'audio' | 'other';
  objectRef: string;
  expiresAt?: string;
}
export interface GenerationProvider {
  id: string;
  submit(request: GenerationRequest): Promise<ProviderJobRef>;
  poll(ref: ProviderJobRef): Promise<ProviderJobStatus>;
  results(ref: ProviderJobRef): Promise<ResultDescriptor[]>;
  cancel?(ref: ProviderJobRef): Promise<boolean>;
}
