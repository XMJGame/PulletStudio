import { Injectable } from '@nestjs/common';
import { resolve } from 'node:path';
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

  constructor() {
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
