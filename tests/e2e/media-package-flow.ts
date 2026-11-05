import { expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readPackageZip } from '../fixtures/read-zip.mjs';
export async function exerciseMediaPackage(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '导出素材包', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出已选素材包', exact: true });
  await dialog.getByRole('button', { name: '预检素材包', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '需要处理选片', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存交付清单', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '镜头素材', exact: true }).click();
  const media = page.getByRole('dialog', { name: '镜头素材与候选', exact: true });
  await media.getByRole('button', { name: /查看候选 Take 02 · clip.mp4/ }).click();
  const review = media.getByRole('region', { name: '候选审核', exact: true });
  for (const action of ['提交审核', '批准候选', '选用此候选']) {
    await review.getByLabel('审核或选片理由').fill('Checked the final material for delivery.');
    await review.getByRole('button', { name: action, exact: true }).click();
  }
  await expect(review).toContainText('镜头选片 · Take 02（有效）');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '导出素材包', exact: true }).click();
  await dialog.getByRole('button', { name: '预检素材包', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '可创建素材包', exact: true })).toBeVisible();
  await dialog.getByLabel('确认范围、选片和原件交付').check();
  let lost = false;
  const pattern = '**/api/v1/projects/*/media-packages';
  await page.route(pattern, async (route) => {
    if (lost || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    lost = true;
    expect((await route.fetch()).status()).toBe(201);
    await route.abort('failed');
  });
  const save = dialog.getByRole('button', { name: '保存交付清单', exact: true });
  await save.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('确认范围、选片和原件交付')).toBeChecked();
  await save.click();
  await expect(dialog.getByRole('status')).toContainText('交付清单已保存');
  await page.unroute(pattern);
  await expect(dialog.getByRole('link', { name: '下载历史素材包', exact: true })).toHaveCount(1);
  await page.screenshot({ path: 'test-results/media-package-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const link = dialog.getByRole('link', { name: '下载素材包 ZIP', exact: true });
  await link.scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/media-package-mobile.png' });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const bytes = await readFile((await download.path())!);
  const zip = readPackageZip(bytes),
    manifest = JSON.parse(zip.get('manifest.json'));
  expect(zip.size).toBe(2);
  expect(manifest.shots).toHaveLength(1);
  expect(manifest.shots[0].take.takeNo).toBe(2);
  expect(manifest.shots[0].source.parameterValues.seed).toBe(0);
  expect(zip.get(manifest.files[0].path)).toEqual(await readFile('test-results/media-fixtures/clip.mp4'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '导出素材包', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
}
