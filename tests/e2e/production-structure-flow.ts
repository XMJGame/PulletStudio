import { expect, Page } from '@playwright/test';

export async function exerciseProductionStructure(page: Page, otherPage: Page) {
  await page.getByRole('button', { name: '制作结构', exact: true }).click();
  await expect(page.getByRole('button', { name: /选择制作单元 裂开的天空/ })).toBeVisible();
  await page.getByRole('button', { name: '新建制作单元', exact: true }).click();
  await expect(page.getByLabel('制作单元名称')).toBeFocused();
  await page.getByLabel('制作单元名称').fill('Arrival');
  await page.getByLabel('单元类型', { exact: true }).selectOption('act');
  await page.getByRole('button', { name: '创建制作单元', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择制作单元 Arrival', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '新建制作单元', exact: true }).click();
  await page.getByLabel('制作单元名称').fill('Platform');
  await page.getByLabel('单元目标时长（秒）').fill('12');
  await expect(page.getByLabel('上级单元')).toHaveValue(/.+/);
  await page.getByRole('button', { name: '创建制作单元', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择制作单元 Platform', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '添加结构镜头', exact: true }).click();
  await page.getByLabel('镜头画面').fill('Train arrives beside an empty platform.');
  await page.getByLabel('计划时长（秒）').fill('8');
  await page.getByLabel('制作方式', { exact: true }).selectOption('image_to_video');
  await page.getByRole('button', { name: '创建结构镜头', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('镜头已创建');
  await page.getByLabel('对白 / 旁白').fill('The last train is here.');
  await page.getByRole('button', { name: '保存镜头', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('镜头已保存');
  await page.getByRole('button', { name: '编辑制作单元', exact: true }).click();
  await page.getByLabel('上级单元').selectOption('');
  await page.getByLabel('单元排序').fill('2');
  await page.getByRole('button', { name: '保存制作单元', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('制作单元已保存');

  // Two sessions cannot silently overwrite unit edits.
  await page.getByRole('button', { name: '编辑制作单元', exact: true }).click();
  await page.getByLabel('单元概述').fill('Local unsaved outline.');
  await otherPage.reload();
  await otherPage.getByRole('button', { name: '制作结构', exact: true }).click();
  await otherPage.getByRole('button', { name: '选择制作单元 Platform', exact: true }).click();
  await otherPage.getByRole('button', { name: '编辑制作单元', exact: true }).click();
  await otherPage.getByLabel('单元概述').fill('Newer outline from another editor.');
  await otherPage.getByRole('button', { name: '保存制作单元', exact: true }).click();
  await expect(otherPage.getByRole('status')).toHaveText('制作单元已保存');
  await page.getByRole('button', { name: '保存制作单元', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('已被修改');
  await expect(page.getByLabel('单元概述')).toHaveValue('Local unsaved outline.');
  await page.getByRole('button', { name: '载入单元最新版本', exact: true }).click();
  await expect(page.getByLabel('单元概述')).toHaveValue('Newer outline from another editor.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const unitSave = await page.getByRole('button', { name: '保存制作单元', exact: true }).boundingBox();
  expect(unitSave!.y + unitSave!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: 'test-results/unit-dialog-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '保存制作单元', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/production-structure-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // A project-settings change previews impact and preserves existing unit/shot durations.
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await page.getByLabel('作品格式').selectOption('film');
  await page.getByLabel('叙事方式').selectOption('hybrid');
  await page.getByLabel('项目目标时长（秒）').fill('4800');
  await page.getByLabel('导演创作说明').fill('Measured suspense; clear visual geography.');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(page.getByText('确认项目设定变更', { exact: true })).toBeVisible();
  await expect(page.getByLabel('作品格式')).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  const confirm = await page.getByRole('button', { name: '确认并保存项目设定', exact: true }).boundingBox();
  expect(confirm!.y + confirm!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: 'test-results/project-impact-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '确认并保存项目设定', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('时长（秒）', { exact: true })).toHaveValue('8');
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Ads start at the project scope, with no forced visible episode.
  await page
    .getByRole('button', { name: /新建项目/ })
    .first()
    .click();
  await page.getByLabel('项目名称').fill('Umbrella launch');
  await page.getByLabel('项目起始模板').selectOption('ad');
  await expect(page.getByLabel('作品格式')).toHaveValue('ad');
  await expect(page.getByLabel('叙事方式')).toHaveValue('none');
  await expect(page.getByLabel('项目目标时长（秒）')).toHaveValue('30');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '制作结构', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加结构镜头', exact: true }).click();
  await page.getByLabel('镜头画面').fill('Compact umbrella on a bright studio surface.');
  await page.getByLabel('制作方式', { exact: true }).selectOption('external');
  await page.getByRole('button', { name: '创建结构镜头', exact: true }).click();
  await expect(page.getByLabel('镜头编号', { exact: true })).toHaveValue('SH001');
  await page.reload();
  await expect(page.getByRole('heading', { name: '制作结构', exact: true })).toBeVisible();
  await expect(page.locator('.structure-shot-list')).toContainText('Compact umbrella');
  await page.getByRole('button', { name: '分集与镜头', exact: true }).click();
  await expect(page.getByRole('tab', { name: /EP/ })).toHaveCount(0);
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await expect(page.getByLabel('作品格式')).toHaveValue('ad');
  await expect(page.getByLabel('项目目标时长（秒）')).toHaveValue('30');
  await page.keyboard.press('Escape');
}
