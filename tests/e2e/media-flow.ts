import { expect, Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createMediaFixtures } from '../fixtures/media-fixtures.mjs';
export async function exerciseMedia(page: Page) {
  const require = createRequire(resolve('package.json'));
  const { AppConfig } = require(resolve('apps/api/dist/config.js'));
  const fixtures = await createMediaFixtures(
    resolve('test-results/media-fixtures'),
    new AppConfig().ffmpegPath,
  );
  await page.getByRole('button', { name: '镜头素材', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '镜头素材与候选' });
  await expect(dialog.getByRole('button', { name: '上传并归档', exact: true })).toBeDisabled();
  const pattern = '**/api/v1/media-uploads/*/content';
  let interrupted = false;
  await page.route(pattern, async (route) => {
    if (interrupted || route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    interrupted = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await dialog.getByLabel('媒体文件', { exact: true }).setInputFiles(fixtures['image.png'].path);
  await dialog.getByRole('button', { name: '上传并归档', exact: true }).click();
  await expect(dialog.getByText('已恢复上传结果', { exact: false })).toBeVisible();
  await page.unroute(pattern);
  await expect
    .poll(() =>
      dialog
        .getByRole('img', { name: '导入媒体预览' })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  const pngHash = createHash('sha256').update(fixtures['image.png'].bytes).digest('hex');
  await expect(dialog).not.toContainText('SHA256');
  await expect(dialog).not.toContainText(pngHash);
  const mediaUrl = await dialog.getByRole('link', { name: '下载原件', exact: true }).getAttribute('href');
  const metadata = await page.request.get(mediaUrl!.split('/content')[0]);
  expect(metadata.ok()).toBe(true);
  expect((await metadata.json()).sha256).toBe(pngHash);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('link', { name: '下载原件', exact: true }).click(),
  ]);
  await download.saveAs('test-results/media-original.png');
  expect(await readFile('test-results/media-original.png')).toEqual(fixtures['image.png'].bytes);
  await dialog.getByRole('button', { name: '添加为当前镜头候选', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /查看候选 Take 01/ })).toBeVisible();
  await dialog.getByLabel('上传目标', { exact: true }).selectOption({ label: 'image.png · 追加 v2' });
  await dialog.getByLabel('媒体文件', { exact: true }).setInputFiles(fixtures['image.jpg'].path);
  await dialog.getByRole('button', { name: '上传并归档', exact: true }).click();
  await expect(dialog.getByLabel('媒体版本预览')).toContainText('image.jpg · v2');
  await dialog.getByRole('button', { name: /查看候选 Take 01/ }).click();
  await expect(dialog.getByLabel('媒体版本预览')).toContainText('image.png · v1');
  await dialog.getByRole('button', { name: '查看媒体 v2', exact: true }).click();
  await expect(dialog.getByLabel('媒体版本预览')).toContainText('image.jpg · v2');
  await dialog.getByLabel('上传目标', { exact: true }).selectOption('');
  await dialog.getByLabel('媒体文件', { exact: true }).setInputFiles(fixtures['clip.mp4'].path);
  await dialog.getByRole('button', { name: '上传并归档', exact: true }).click();
  const video = dialog.locator('video');
  await expect(video).toBeVisible();
  await expect(dialog.getByRole('button', { name: '查看媒体 v2', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '查看媒体 v1', exact: true })).toBeVisible();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThan(0);
  expect(
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
      const playing = !element.paused;
      element.pause();
      return playing;
    }),
  ).toBe(true);
  await expect(dialog.getByLabel('媒体版本预览')).toContainText('含声音流');
  await dialog.getByRole('button', { name: '添加为当前镜头候选', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /查看候选 Take 02/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await video.scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'test-results/media-video-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.getByLabel('媒体文件', { exact: true }).setInputFiles(fixtures['sound.wav'].path);
  await dialog.getByRole('button', { name: '上传并归档', exact: true }).click();
  const audio = dialog.locator('audio');
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThan(0);
  expect(
    await audio.evaluate(async (element: HTMLAudioElement) => {
      element.muted = true;
      await element.play();
      const playing = !element.paused;
      element.pause();
      return playing;
    }),
  ).toBe(true);
  await dialog.getByRole('button', { name: '添加为当前镜头候选', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /查看候选 Take 03/ })).toBeVisible();
  await dialog.getByLabel('媒体文件', { exact: true }).setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<html>Not an image</html>'),
  });
  await dialog.getByRole('button', { name: '上传并归档', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('不支持此文件内容');
  expect(
    await dialog
      .getByLabel('媒体文件', { exact: true })
      .evaluate((element: HTMLInputElement) => element.files?.[0].name),
  ).toBe('fake.png');
  await dialog.getByLabel('媒体文件', { exact: true }).setInputFiles(fixtures['image.webp'].path);
  await dialog.getByRole('button', { name: '上传并归档', exact: true }).click();
  await expect(dialog.getByText('媒体已完成归档', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '上传并归档', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '镜头素材', exact: true })).toBeFocused();
  await page.reload();
  await page.getByRole('button', { name: '制作结构', exact: true }).click();
  await page.locator('.structure-shot-list button').filter({ hasText: 'SH001' }).click();
  await page.getByRole('button', { name: '镜头素材', exact: true }).click();
  await expect(dialog.locator('.media-library article')).toHaveCount(4);
  await expect(dialog.getByRole('button', { name: /查看候选 Take / })).toHaveCount(3);
  await page.screenshot({ path: 'test-results/media-library-desktop.png' });
  await page.keyboard.press('Escape');
}
