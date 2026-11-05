import { Injectable } from '@nestjs/common';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from 'dotenv';

export const repositoryRoot = resolve(__dirname, '../../..');
config({ path: resolve(repositoryRoot, '.env'), quiet: true });

@Injectable()
export class AppConfig {
  readonly databasePath = resolve(repositoryRoot, process.env.DATABASE_PATH || './data/studio.sqlite');
  readonly setupToken = process.env.SETUP_TOKEN || '';
  readonly origins = (process.env.APP_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((x) => new URL(x.trim()).origin);
  readonly secureCookie = process.env.COOKIE_SECURE === 'true';
  readonly sessionHours = Number(process.env.SESSION_HOURS || 12);
  readonly port = Number(process.env.PORT || 3100);
  readonly providerMasterKey = process.env.PROVIDER_MASTER_KEY || '';
  readonly mediaRoot = resolve(
    repositoryRoot,
    process.env.MEDIA_ROOT || resolve(dirname(this.databasePath), 'media'),
  );
  readonly mediaMaxBytes = Number(process.env.MEDIA_MAX_BYTES || 512 * 1024 * 1024);
  readonly mediaUploadTimeoutMs = Number(process.env.MEDIA_UPLOAD_TIMEOUT_MS || 600000);
  readonly ffprobePath = process.env.FFPROBE_PATH || localMediaTool('ffprobe');
  readonly ffmpegPath = process.env.FFMPEG_PATH || localMediaTool('ffmpeg');

  constructor() {
    if (
      !Number.isSafeInteger(this.mediaMaxBytes) ||
      this.mediaMaxBytes < 1 ||
      this.mediaMaxBytes > 2 * 1024 * 1024 * 1024
    )
      throw new Error('MEDIA_MAX_BYTES must be 1..2147483648');
    if (
      !Number.isSafeInteger(this.mediaUploadTimeoutMs) ||
      this.mediaUploadTimeoutMs < 1000 ||
      this.mediaUploadTimeoutMs > 1800000
    )
      throw new Error('MEDIA_UPLOAD_TIMEOUT_MS must be 1000..1800000');
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65535)
      throw new Error('PORT must be an integer from 0 to 65535');
    if (!Number.isFinite(this.sessionHours) || this.sessionHours < 1 || this.sessionHours > 168)
      throw new Error('SESSION_HOURS must be between 1 and 168');
    if (this.setupToken && this.setupToken.length < 32)
      throw new Error('SETUP_TOKEN must contain at least 32 characters');
    if (
      (process.env.DATABASE_PATH || '').startsWith('\\\\') ||
      (process.env.DATABASE_PATH || '').startsWith('//')
    )
      throw new Error('SQLite must use local disk, not a network share');
    if (process.env.NODE_ENV === 'production' && !this.secureCookie)
      throw new Error('Production requires COOKIE_SECURE=true and HTTPS');
  }
}
function localMediaTool(name: string) {
  const candidate = resolve(repositoryRoot, `data/tools/ffmpeg/bin/${name}.exe`);
  return process.platform === 'win32' && existsSync(candidate) ? candidate : name;
}
