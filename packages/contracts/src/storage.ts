/** Storage implementation must enforce scoped access and object-key validation. */
export interface StorageObjectInfo { key: string; bytes: number; sha256: string; contentType: string; }
export interface StorageProvider {
  id: string;
  put(key: string, body: AsyncIterable<Uint8Array>, contentType: string): Promise<StorageObjectInfo>;
  get(key: string): Promise<AsyncIterable<Uint8Array>>;
  stat(key: string): Promise<StorageObjectInfo | null>;
  delete(key: string): Promise<void>;
}
