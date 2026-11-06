import { selectLegacyView } from './legacy-navigation';
import { expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function exerciseStoryboardExports(page: Page, otherPage: Page) {
  await page.getByRole('button', { name: '导出分镜文档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出分镜文档' });
  await expect(dialog.getByRole('button', { name: '生成分镜文件', exact: true })).toBeDisabled();
  await page.getByLabel('导出范围', { exact: true }).selectOption('project');
  await page.getByRole('button', { name: '预览分镜导出', exact: true }).click();
  await expect(page.getByLabel('分镜导出预览')).toContainText('2 个镜头');
  await expect(page.getByLabel('分镜导出预览')).toContainText('历史输入');
  await otherPage.reload();
  await otherPage.getByRole('button', { name: /Umbrella launch/ }).click();
  await selectLegacyView(otherPage, '制作结构');
  await otherPage.locator('.structure-shot-list button').filter({ hasText: 'SH001' }).click();
  await otherPage
    .getByRole('textbox', { name: '画面描述', exact: true })
    .fill('Later change while export was previewed.');
  await otherPage.getByRole('button', { name: '保存镜头', exact: true }).click();
  await expect(otherPage.getByRole('status')).toContainText('镜头已保存');
  await page.getByRole('button', { name: '生成分镜文件', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('重新预览');
  await expect(page.getByLabel('导出范围', { exact: true })).toHaveValue('project');
  await page.getByRole('button', { name: '重新预览分镜导出', exact: true }).click();
  // The API commits, but the response is lost. The UI must reuse its key on retry.
  const pattern = '**/api/v1/projects/*/storyboard-exports';
  let intercepted = false;
  let committedId = '';
  await page.route(pattern, async (route) => {
    if (intercepted || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    intercepted = true;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committedId = (await response.json()).id;
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '生成分镜文件', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '生成分镜文件', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '生成分镜文件', exact: true }).click();
  await expect(page.getByLabel('已生成分镜导出')).toContainText('复用已有请求');
  await page.unroute(pattern);
  async function download(format: string) {
    const [value] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: `下载 ${format.toUpperCase()} 分镜文件`, exact: true }).click(),
    ]);
    expect(value.suggestedFilename()).toMatch(new RegExp(`^storyboard-[a-f0-9-]+\\.${format}$`));
    const path = `test-results/storyboard-export.${format}`;
    await value.saveAs(path);
    const buffer = await readFile(path);
    const fileUrl = await page
      .getByRole('link', { name: `下载 ${format.toUpperCase()} 分镜文件`, exact: true })
      .getAttribute('href');
    const metadata = await page.request.get(fileUrl!.replace(/\/file$/, ''));
    expect(metadata.ok()).toBe(true);
    const checksum = createHash('sha256').update(buffer).digest('hex');
    expect((await metadata.json()).sha256).toBe(checksum);
    await expect(dialog).not.toContainText('SHA256');
    await expect(dialog).not.toContainText(checksum);
    return buffer;
  }
  const json = await download('json');
  const document = JSON.parse(json.toString('utf8'));
  expect(document.exportId).toBe(committedId);
  expect(document.shots).toHaveLength(2);
  expect(document.shots.find((shot: { code: string }) => shot.code === 'SH001').basic.description).toBe(
    'Later change while export was previewed.',
  );
  expect(
    document.shots.find((shot: { code: string }) => shot.code === 'SH001').prompt.snapshot.card.body
      .description,
  ).toBe('An umbrella opens on a white table.');
  await page.getByLabel('导出格式', { exact: true }).selectOption('md');
  await expect(dialog.getByRole('button', { name: '生成分镜文件', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '预览分镜导出', exact: true }).click();
  await page.getByRole('button', { name: '生成分镜文件', exact: true }).click();
  const md = (await download('md')).toString('utf8');
  expect(md).toContain('完整正向提示词');
  expect(md).toContain('完整制作卡');
  await page.getByLabel('导出格式', { exact: true }).selectOption('csv');
  await page.getByLabel('导出范围', { exact: true }).selectOption('shots');
  await page.getByLabel('提示词来源', { exact: true }).selectOption('neutral');
  await page.getByRole('button', { name: '预览分镜导出', exact: true }).click();
  await expect(page.getByLabel('分镜导出预览')).toContainText('1 个镜头');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: '生成分镜文件', exact: true })).toBeInViewport({
    ratio: 1,
  });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/storyboard-export-mobile.png' });
  await page.getByRole('button', { name: '生成分镜文件', exact: true }).click();
  const csv = (await download('csv')).toString('utf8');
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('Later change while export was previewed.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '导出分镜文档', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '导出分镜文档', exact: true }).click();
  await expect(dialog.locator('.export-history-item')).toHaveCount(3);
  const [again] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('link', { name: /下载 JSON ·/ }).click(),
  ]);
  await again.saveAs('test-results/storyboard-export-again.json');
  expect(await readFile('test-results/storyboard-export-again.json')).toEqual(json);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/storyboard-export-history-desktop.png' });
  await page.keyboard.press('Escape');
}
