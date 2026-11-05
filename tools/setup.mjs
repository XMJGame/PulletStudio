import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const template = await readFile(new URL('.env.example', root), 'utf8');
try {
  await writeFile(
    new URL('.env', root),
    template
      .replace(/^SETUP_TOKEN=.*$/m, `SETUP_TOKEN=${randomBytes(32).toString('hex')}`)
      .replace(/^PROVIDER_MASTER_KEY=.*$/m, `PROVIDER_MASTER_KEY=${randomBytes(32).toString('hex')}`),
    { flag: 'wx', mode: 0o600 },
  );
  console.log('.env created. Read its SETUP_TOKEN locally to initialize the administrator in the web UI.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const current = await readFile(new URL('.env', root), 'utf8');
  if (!/^PROVIDER_MASTER_KEY=.+$/m.test(current)) {
    const entry = `PROVIDER_MASTER_KEY=${randomBytes(32).toString('hex')}`;
    const updated = /^PROVIDER_MASTER_KEY=.*$/m.test(current)
      ? current.replace(/^PROVIDER_MASTER_KEY=.*$/m, entry)
      : `${current.trimEnd()}\n${entry}\n`;
    await writeFile(new URL('.env', root), updated, { mode: 0o600 });
    console.log('Provider encryption key added locally; existing account and setup settings preserved.');
  } else console.log('.env already exists; it has not been changed.');
}
