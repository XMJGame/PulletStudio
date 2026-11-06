import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only the isolated E2E browser profile loads this local extension. No user profile is modified.
// Actual tab zoom API: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom
export async function zoomBrowser(chromium, directory) {
  const extension = resolve(directory, 'extension');
  await mkdir(extension, { recursive: true });
  await writeFile(
    resolve(extension, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Pullet isolated zoom acceptance',
      version: '1.0',
      permissions: ['tabs'],
      background: { service_worker: 'worker.js' },
    }),
  );
  await writeFile(resolve(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  const context = await chromium.launchPersistentContext(resolve(directory, 'profile'), {
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker =
      context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker', { timeout: 10000 }));
    return {
      context,
      setZoom: (url, factor) =>
        worker.evaluate(
          async ({ url, factor }) => {
            const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
            if (!tab?.id) throw new Error('Isolated test tab was not found');
            await chrome.tabs.setZoomSettings(tab.id, { mode: 'automatic', scope: 'per-tab' });
            await chrome.tabs.setZoom(tab.id, factor);
            return chrome.tabs.getZoom(tab.id);
          },
          { url, factor },
        ),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}
