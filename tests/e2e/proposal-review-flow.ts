import { selectLegacyView } from './legacy-navigation';
import { expect, Page } from '@playwright/test';
export async function exerciseProposalReview(page: Page, otherPage: Page) {
  const preview = page.getByLabel('分镜草案预览');
  await expect(preview.getByRole('button', { name: '采纳为正式镜头', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '编辑候选 1', exact: true }).click();
  await page.getByLabel('候选画面描述').fill('Local review text not yet saved.');
  await page.getByLabel('候选计划时长（秒）').fill('8');
  await otherPage.reload();
  await otherPage.getByRole('button', { name: /Umbrella launch/ }).click();
  await selectLegacyView(otherPage, 'AI 分镜');
  await otherPage.getByRole('button', { name: '编辑候选 1', exact: true }).click();
  await otherPage.getByLabel('候选画面描述').fill('Other editor proposal revision.');
  await otherPage.getByLabel('候选计划时长（秒）').fill('7');
  await otherPage.getByRole('button', { name: '保存候选修订', exact: true }).click();
  await expect(otherPage.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '保存候选修订', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('已被修改');
  await expect(page.getByLabel('候选画面描述')).toHaveValue('Local review text not yet saved.');
  await page.getByRole('button', { name: '载入最新草案', exact: true }).click();
  await expect(page.getByLabel('候选画面描述')).toHaveValue('Other editor proposal revision.');
  await page.getByLabel('候选画面描述').fill('Human-reviewed umbrella opening on a bright table.');
  await page.getByLabel('候选计划时长（秒）').fill('8');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const save = await page.getByRole('button', { name: '保存候选修订', exact: true }).boundingBox();
  expect(save!.y).toBeGreaterThanOrEqual(0);
  expect(save!.y + save!.height).toBeLessThanOrEqual(844);
  await expect(page.getByRole('button', { name: '保存候选修订', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'test-results/candidate-editor-mobile.png' });
  await page.getByRole('button', { name: '保存候选修订', exact: true }).click();
  await expect(preview).toContainText('Human-reviewed umbrella');
  await page.getByRole('button', { name: '拒绝草案', exact: true }).click();
  await page.getByLabel('审核理由').fill('Timing requires a second review.');
  await page.getByRole('button', { name: '确认拒绝草案', exact: true }).click();
  await expect(preview).toContainText('拒绝理由：Timing requires a second review.');
  await page.getByRole('button', { name: '重开草案', exact: true }).click();
  await page.getByLabel('审核理由').fill('Timing and source checked.');
  await page.getByRole('button', { name: '确认重开草案', exact: true }).click();
  await page.getByRole('button', { name: '查看草案修订', exact: true }).click();
  await page.getByRole('button', { name: /预览草案 v0/ }).click();
  await expect(page.getByRole('dialog')).toContainText('时长待实际声音 / 节奏确认');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '采纳为正式镜头', exact: true }).click();
  await page.getByLabel('正式镜头目标', { exact: true }).selectOption('');
  await expect(page.getByRole('button', { name: '确认创建正式镜头', exact: true })).toBeDisabled();
  await page.getByLabel('已核对候选内容').check();
  const confirm = await page.getByRole('button', { name: '确认创建正式镜头', exact: true }).boundingBox();
  expect(confirm!.y).toBeGreaterThanOrEqual(0);
  expect(confirm!.y + confirm!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: 'test-results/proposal-accept-mobile.png' });
  await page.getByRole('button', { name: '确认创建正式镜头', exact: true }).click();
  await expect(preview.getByRole('button', { name: '查看正式镜头 SH002', exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: '编辑候选 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '查看正式镜头 SH002', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '完整镜头制作卡' })).toContainText('Human-reviewed umbrella');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectLegacyView(page, '制作结构');
  await expect(page.locator('.structure-shot-list button')).toHaveCount(2);
  await page.locator('.structure-shot-list button').filter({ hasText: 'Human-reviewed umbrella' }).click();
  await page
    .getByRole('textbox', { name: '画面描述', exact: true })
    .fill('Formal shot revised after adoption.');
  await page.getByRole('button', { name: '保存镜头', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('镜头已保存');
  await page.getByRole('button', { name: '查看完整制作卡', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Formal shot revised after adoption.');
  await page.getByRole('button', { name: /预览制作卡 v1/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Human-reviewed umbrella opening on a bright table.');
  await page.getByRole('dialog').getByText('查看引用原文', { exact: true }).click();
  await expect(page.getByRole('dialog').locator('blockquote')).toContainText('compact umbrella');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/shot-card-history-mobile.png' });
  await page.keyboard.press('Escape');
}
