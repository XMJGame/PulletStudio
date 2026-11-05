import { expect, Page } from '@playwright/test';
export async function exerciseTextDelivery(page: Page, otherPage: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.structure-shot-list button').filter({ hasText: 'SH001' }).click();
  await page.getByRole('button', { name: '镜头提示词', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('请先编辑并保存完整制作卡');
  await expect(page.getByRole('button', { name: '预览完整提示词', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '编辑完整制作卡', exact: true }).click();
  await page.getByLabel('制作卡标题', { exact: true }).fill('Umbrella reveal');
  await page.getByLabel('制作卡构图', { exact: true }).fill('Local composition before conflict');
  await otherPage.reload();
  await otherPage.getByRole('button', { name: /Umbrella launch/ }).click();
  await otherPage.getByRole('button', { name: '制作结构', exact: true }).click();
  await otherPage.locator('.structure-shot-list button').filter({ hasText: 'SH001' }).click();
  await otherPage.getByRole('button', { name: '编辑完整制作卡', exact: true }).click();
  await otherPage.getByLabel('制作卡构图', { exact: true }).fill('Other editor composition');
  await otherPage.getByRole('button', { name: '保存完整制作卡', exact: true }).click();
  await expect(otherPage.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '保存完整制作卡', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('已被修改');
  await expect(page.getByLabel('制作卡构图', { exact: true })).toHaveValue(
    'Local composition before conflict',
  );
  await page.getByRole('button', { name: '载入最新制作卡', exact: true }).click();
  await expect(page.getByLabel('制作卡构图', { exact: true })).toHaveValue('Other editor composition');
  await page.getByLabel('制作卡标题', { exact: true }).fill('Umbrella reveal');
  await page.getByLabel('制作卡画面描述', { exact: true }).fill('An umbrella opens on a white table.');
  await page.getByLabel('制作卡创作意图', { exact: true }).fill('Show a compact product clearly.');
  await page.getByLabel('制作卡景别', { exact: true }).fill('Close up');
  await page.getByLabel('制作卡构图', { exact: true }).fill('Product centered with room for copy');
  await page.getByLabel('制作卡动作', { exact: true }).fill('The canopy unfolds');
  await page.getByLabel('原声处理计划', { exact: true }).selectOption('mute');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '保存完整制作卡', exact: true })).toBeInViewport({
    ratio: 1,
  });
  expect(
    await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/full-card-editor-mobile.png' });
  await page.getByRole('button', { name: '保存完整制作卡', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '镜头提示词', exact: true }).click();
  await page.getByRole('button', { name: '新建提示词 Profile', exact: true }).click();
  await page.getByLabel('Profile 名称', { exact: true }).fill('Product clarity');
  await page.getByLabel('正向约束（每行一项）', { exact: true }).fill('Keep the logo area readable');
  await page.getByLabel('禁止项（每行一项）', { exact: true }).fill('Watermark\nExtra hands');
  await page.getByRole('button', { name: '保存 Profile 修订', exact: true }).click();
  await expect(page.getByLabel('提示词 Profile', { exact: true })).toContainText('Product clarity');
  await page.getByRole('button', { name: '预览完整提示词', exact: true }).click();
  await expect(page.getByLabel('完整正向提示词', { exact: true })).toContainText(
    'Keep the logo area readable',
  );
  await expect(page.getByLabel('完整正向提示词', { exact: true })).toContainText('静音原声');
  await expect(page.getByLabel('完整负面提示词', { exact: true })).toHaveValue('Watermark；Extra hands');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制完整提示词', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('完整提示词已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Extra hands');
  await expect(page.getByRole('button', { name: '保存提示词快照', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: 'test-results/prompt-preview-mobile.png' });
  await page.getByRole('button', { name: '保存提示词快照', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('提示词快照已保存');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('textbox', { name: '画面描述', exact: true }).fill('A new product angle.');
  await page.getByRole('button', { name: '保存镜头', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('镜头已保存');
  await page.getByRole('button', { name: '镜头提示词', exact: true }).click();
  await page.getByRole('button', { name: /查看提示词快照/ }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('镜头已有新版本');
  await expect(page.getByLabel('完整正向提示词', { exact: true })).toContainText(
    'An umbrella opens on a white table.',
  );
  await page.screenshot({ path: 'test-results/prompt-history-desktop.png' });
  await page.keyboard.press('Escape');
}
