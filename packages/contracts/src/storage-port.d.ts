/** Object transport only. Application services enforce project authorization. */
export interface StoredObject {
  key: string;
  bytes: number;
  sha256: string;
}
export interface StoredRange {
  start: number;
  end: number;
}
export interface UploadLimits {
  bytes: number;
  timeoutMs: number;
}
export interface StorageProvider {
  readonly kind: string;
  stage(
    sessionId: string,
    body: AsyncIterable<Uint8Array>,
    limits: UploadLimits,
    signal?: AbortSignal,
  ): Promise<StoredObject>;
  publish(sessionId: string, objectPrefix: string): Promise<void>;
  stat(key: string): Promise<{ bytes: number } | null>;
  openVerified(
    key: string,
    expected: { bytes: number; sha256: string },
    range?: StoredRange,
  ): Promise<AsyncIterable<Uint8Array>>;
  discardStaging(sessionId: string): Promise<void>;
}
