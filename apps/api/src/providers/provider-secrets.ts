import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../config';
import { fail } from '../common/http';

@Injectable()
export class ProviderSecrets {
  constructor(private readonly config: AppConfig) {}
  get ready() {
    return /^[a-f0-9]{64}$/i.test(this.config.providerMasterKey);
  }
  private key() {
    if (!this.ready)
      fail(503, 'PROVIDER_KEY_REQUIRED', '请在本机运行 npm run setup 并重启服务，初始化 Provider 加密密钥');
    return Buffer.from(this.config.providerMasterKey, 'hex');
  }
  encrypt(value: string, connectionId: string, workspaceId: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(`${connectionId}:${workspaceId}`));
    return JSON.stringify({
      v: 1,
      iv: iv.toString('base64'),
      data: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    });
  }
  decrypt(value: string | null, connectionId: string, workspaceId: string) {
    if (value === null) return null;
    try {
      const box = JSON.parse(value);
      if (box.v !== 1) throw Error();
      const cipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(box.iv, 'base64'));
      cipher.setAAD(Buffer.from(`${connectionId}:${workspaceId}`));
      cipher.setAuthTag(Buffer.from(box.tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(box.data, 'base64')), cipher.final()]).toString('utf8');
    } catch {
      fail(503, 'PROVIDER_KEY_UNAVAILABLE', 'Provider 凭据无法解密，请检查本机密钥或重新设置连接凭据');
    }
  }
}
