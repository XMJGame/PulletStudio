import { expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
export async function exerciseAnimatic(page: Page) {
  await page.getByRole('button', { name: '时间线与预演', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '时间线与预演', exact: true });
  await dialog.getByRole('button', { name: '按当前选片载入', exact: true }).click();
  await expect(dialog.getByLabel('SH002 预演原声', { exact: true })).toHaveValue('');
  await dialog.getByRole('combobox', { name: '预演画幅', exact: true }).selectOption('square');
  await dialog.getByLabel('SH002 入点（秒）', { exact: true }).fill('0.1');
  await dialog.getByLabel('SH002 片段时长（秒）', { exact: true }).fill('0.501');
  await dialog.getByLabel('SH002 预演原声', { exact: true }).selectOption('keep');
  await dialog.getByRole('button', { name: '预览时间线', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '时间线预览', exact: true })).toContainText(
    '480×480 · 25 fps · 0.52 秒',
  );
  let lost = false;
  const pattern = '**/api/v1/projects/*/timelines';
  await page.route(pattern, async (route) => {
    if (lost || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    lost = true;
    expect((await route.fetch()).status()).toBe(201);
    await route.abort('failed');
  });
  await dialog.getByRole('button', { name: '保存时间线版本', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('SH002 片段时长（秒）', { exact: true })).toHaveValue('0.501');
  await dialog.getByRole('button', { name: '保存时间线版本', exact: true }).click();
  await page.unroute(pattern);
  const saved = dialog.getByRole('region', { name: '已保存时间线', exact: true });
  await expect(saved.getByRole('heading')).toHaveText('时间线 v1 · 0.52 秒');
  await expect(dialog.getByRole('button', { name: '查看时间线 v1 · 0.52 秒', exact: true })).toHaveCount(1);
  await saved.getByRole('button', { name: '生成低清预演', exact: true }).click();
  await expect(saved.getByText('预演已归档', { exact: true })).toBeVisible({ timeout: 20000 });
  const video = saved.locator('video');
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.1);
  expect(await video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(480);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await saved.getByText('已保存片段', { exact: true }).click();
  await expect(saved).toContainText('入点 0.100 秒');
  await saved.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/animatic-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await video.scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/animatic-mobile.png' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    saved.getByRole('link', { name: '下载预演原件', exact: true }).click(),
  ]);
  expect((await readFile((await download.path())!)).toString('ascii', 4, 8)).toBe('ftyp');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '时间线与预演', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '时间线与预演', exact: true }).click();
  await dialog.getByRole('button', { name: '查看时间线 v1 · 0.52 秒', exact: true }).click();
  await expect(saved.getByText('预演已归档', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
}
