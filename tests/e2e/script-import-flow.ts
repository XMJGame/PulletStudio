import { selectLegacyView } from './legacy-navigation';
import { expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export async function exerciseScriptImport(page: Page, otherPage: Page) {
  await selectLegacyView(page, '项目剧本');
  await page.getByRole('button', { name: '导入剧本', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入剧本', exact: true });
  await expect(page.getByLabel('导入后的剧本标题')).toBeFocused();
  const text = '# Platform\r\nMira: The train is late. 🚆\r\n\r\nNoah folds the blue umbrella.\n';
  const bytes = Buffer.from('\uFEFF' + text, 'utf8');
  await page
    .getByLabel('选择原文文件')
    .setInputFiles({ name: 'platform.md', mimeType: 'text/markdown', buffer: bytes });
  await expect(page.getByLabel('导入内容预览')).toHaveValue(text.replace(/\r\n/g, '\n'));
  await page.getByLabel('导入后的剧本标题').fill('Platform dialogue');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const submit = await page.getByRole('button', { name: '导入为新版本', exact: true }).boundingBox();
  expect(submit!.y + submit!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: 'test-results/script-import-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '导入为新版本', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('原文已导入为 v4');
  await page.getByRole('button', { name: '查看原文与段落', exact: true }).click();
  await page.getByRole('button', { name: '定位段落 2', exact: true }).click();
  expect(
    await page
      .getByLabel('已保存原文')
      .evaluate((element: HTMLTextAreaElement) =>
        element.value.slice(element.selectionStart, element.selectionEnd),
      ),
  ).toBe('Mira: The train is late. 🚆\n');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载导入原文', exact: true }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!)).toEqual(bytes);
  expect(
    await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/script-source-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '查看原文与段落', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '锁定当前版本', exact: true }).click();
  await expect(page.getByLabel('剧本正文')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: '导入剧本', exact: true })).toBeDisabled();
  await page.reload();
  await selectLegacyView(page, '项目剧本');
  await expect(page.getByText('当前定稿已锁定', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '解锁以继续修订', exact: true }).click();
  await expect(page.getByLabel('剧本正文')).not.toHaveAttribute('readonly', '');

  // A second editor advances the head while the first keeps its import preview.
  await page.getByRole('button', { name: '导入剧本', exact: true }).click();
  await page.getByLabel('导入方式').selectOption('paste');
  await page.getByLabel('原文类型').selectOption('brief');
  await page.getByLabel('粘贴原文').fill('30-second umbrella advert. White background, compact form.');
  await page.getByLabel('导入后的剧本标题').fill('Umbrella advert');
  await otherPage.reload();
  await selectLegacyView(otherPage, '项目剧本');
  await otherPage.getByLabel('剧本正文').fill('Second editor revision before import.');
  await otherPage.getByRole('button', { name: '保存剧本版本', exact: true }).click();
  await expect(otherPage.getByRole('status')).toContainText('v5');
  await page.getByRole('button', { name: '导入为新版本', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('已被修改');
  await expect(page.getByLabel('粘贴原文')).toHaveValue(
    '30-second umbrella advert. White background, compact form.',
  );
  await page.getByRole('button', { name: '刷新版本后重试', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '导入为新版本', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('原文已导入为 v6');
  await expect(page.getByLabel('剧本标题')).toHaveValue('Umbrella advert');
  await expect(page.locator('.revision-item')).toHaveCount(6);
}
