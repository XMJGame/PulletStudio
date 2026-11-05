import { expect, Page } from '@playwright/test';

export async function exerciseTextAnalysis(page: Page) {
  await page.getByRole('button', { name: '项目剧本', exact: true }).click();
  await page.getByLabel('剧本标题').fill('Umbrella brief');
  await page.getByLabel('剧本正文').fill('30-second advert. A compact umbrella opens on a studio table.');
  await page.getByRole('button', { name: '保存剧本版本', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('v1');
  await page.getByRole('button', { name: 'AI 分镜', exact: true }).click();
  await page.getByRole('button', { name: '文本模型连接', exact: true }).click();
  await page.getByRole('button', { name: '新增文本连接', exact: true }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('隔离浏览器模拟');
  await page.getByLabel('API 基础地址').fill('http://127.0.0.1:3118/v1');
  await page.getByLabel('API Key', { exact: true }).fill('browser-fixture-key');
  await page.getByLabel('批准访问此自部署端点').check();
  await page.getByLabel('模型配置名称').fill('模拟分镜模型');
  await page.getByLabel('模型名称', { exact: true }).fill('valid');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.getByRole('button', { name: '保存文本连接', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/text-connection-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '保存文本连接', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('文本连接已保存');
  await expect(page.getByRole('dialog').getByText('已加密保存凭据', { exact: false })).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('API Key', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('分析文本模型')).toContainText('模拟分镜模型');
  await page
    .getByLabel('本次分析上下文摘要')
    .fill('A neutral product demonstration; no narration timing is approved.');
  await page.getByLabel('确认将所选原文范围').check();
  await page.getByRole('button', { name: '创建分镜分析任务', exact: true }).click();
  const preview = page.getByLabel('分镜草案预览');
  await expect(preview).toBeVisible({ timeout: 12000 });
  await expect(preview).toContainText('Mock storyboard draft');
  await expect(preview).toContainText('时长待实际声音 / 节奏确认');
  await preview.getByText('查看引用原文', { exact: true }).click();
  await expect(preview.locator('blockquote')).toContainText('compact umbrella');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/analysis-draft-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/analysis-draft-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '制作结构', exact: true }).click();
  await expect(page.locator('.structure-shot-list button')).toHaveCount(1);
  await page.getByRole('button', { name: 'AI 分镜', exact: true }).click();
  await expect(page.getByLabel('分镜草案预览')).toContainText('Mock storyboard draft');
}
