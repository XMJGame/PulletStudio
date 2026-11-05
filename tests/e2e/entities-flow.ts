import { expect, Page } from '@playwright/test';
export async function exerciseEntities(page: Page, otherPage: Page) {
  await page.getByRole('button', { name: '资产库', exact: true }).click();
  const library = page.getByRole('dialog', { name: '资产库', exact: true });
  await library.getByLabel('资产名称', { exact: true }).fill('Mira');
  await library.getByLabel('资产描述', { exact: true }).fill('A shop visitor.');
  await library.getByLabel('外观设定', { exact: true }).fill('Short hair');
  await library.getByLabel('服装设定', { exact: true }).fill('Blue jacket');
  await library.getByLabel('参考素材', { exact: true }).selectOption({ label: 'image.png' });
  await library.getByLabel('参考版本', { exact: true }).selectOption({ label: 'image.png · v1' });
  await library.getByRole('button', { name: '添加媒体参考', exact: true }).click();
  const pattern = '**/api/v1/projects/*/entities';
  let lost = false;
  await page.route(pattern, async (route) => {
    if (lost || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    lost = true;
    expect((await route.fetch()).status()).toBe(201);
    await route.abort('failed');
  });
  await library.getByRole('button', { name: '保存资产版本', exact: true }).click();
  await expect(library.getByRole('alert')).toBeVisible();
  await expect(library.getByLabel('资产名称', { exact: true })).toHaveValue('Mira');
  await library.getByRole('button', { name: '保存资产版本', exact: true }).click();
  await expect(library.getByRole('status')).toContainText('v1');
  await expect
    .poll(() =>
      library
        .getByRole('img', { name: '正面主锚点参考图' })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(library.getByRole('button', { name: 'Mira · v1 · 草稿', exact: true })).toHaveCount(1);
  await page.unroute(pattern);
  for (const [tab, name, attribute, content, media, role] of [
    ['场景', 'Shop', '空间布局', 'Door on the left', 'image.png', '全景'],
    ['道具', 'Umbrella', '材质', 'Fabric', 'image.png', '细节'],
    ['声音角色', 'Narrator', '音色描述', 'Warm and calm', 'sound.wav', '声音样本'],
  ]) {
    await library.getByRole('button', { name: tab, exact: true }).click();
    await library.getByLabel('资产名称', { exact: true }).fill(name);
    await library.getByLabel(attribute, { exact: true }).fill(content);
    await library.getByLabel('参考素材', { exact: true }).selectOption({ label: media });
    await library.getByLabel('参考版本', { exact: true }).selectOption({ index: 1 });
    await library.getByLabel('参考位置', { exact: true }).selectOption({ label: role });
    await library.getByRole('button', { name: '添加媒体参考', exact: true }).click();
    await library.getByRole('button', { name: '保存资产版本', exact: true }).click();
    await expect(library.getByRole('status')).toContainText(`已保存「${name}」v1`);
  }
  await expect(library).not.toContainText('SHA256');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '资产引用', exact: true }).click();
  const binding = page.getByRole('dialog', { name: '镜头资产引用', exact: true });
  for (const [label, purpose] of [
    ['人物 · Mira', 'Left of frame'],
    ['场景 · Shop', 'Shop background'],
    ['道具 · Umbrella', 'Held in hand'],
    ['声音角色 · Narrator', 'Narration'],
  ]) {
    await binding.getByLabel('引用资产', { exact: true }).selectOption({ label });
    await expect(binding.getByLabel('引用修订', { exact: true })).not.toHaveValue('');
    await binding.getByLabel('镜头中的用途', { exact: true }).fill(purpose);
    await binding.getByRole('button', { name: '加入引用列表', exact: true }).click();
  }
  await expect(binding.getByLabel('已选资产引用').locator('article')).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await binding.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(binding.getByRole('button', { name: '保存镜头资产引用', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: 'test-results/entity-bindings-mobile.png' });
  await binding.getByRole('button', { name: '保存镜头资产引用', exact: true }).click();
  await expect(binding).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '镜头提示词', exact: true }).click();
  const prompt = page.getByRole('dialog', { name: '镜头提示词', exact: true });
  await prompt.getByRole('button', { name: '预览完整提示词', exact: true }).click();
  await expect(prompt.getByLabel('完整正向提示词', { exact: true })).toHaveValue(/Short hair/);
  await expect(prompt.getByLabel('完整正向提示词', { exact: true })).toHaveValue(/Left of frame/);
  await expect(prompt).toContainText('授权/同意');
  await prompt.getByRole('button', { name: '保存提示词快照', exact: true }).click();
  await expect(prompt.getByRole('status')).toContainText('提示词快照已保存');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '资产库', exact: true }).click();
  await library.getByRole('button', { name: 'Mira · v1 · 草稿', exact: true }).click();
  await library.getByLabel('资产描述', { exact: true }).fill('Local unsaved description');
  await otherPage.reload();
  await otherPage.getByRole('button', { name: /Umbrella launch/ }).click();
  await otherPage.getByRole('button', { name: '制作结构', exact: true }).click();
  await otherPage.getByRole('button', { name: '资产库', exact: true }).click();
  const otherLibrary = otherPage.getByRole('dialog', { name: '资产库', exact: true });
  await otherLibrary.getByRole('button', { name: 'Mira · v1 · 草稿', exact: true }).click();
  await otherLibrary.getByLabel('外观设定', { exact: true }).fill('Long hair');
  await otherLibrary.getByRole('button', { name: '保存资产版本', exact: true }).click();
  await expect(otherLibrary.getByRole('status')).toContainText('v2');
  await library.getByRole('button', { name: '保存资产版本', exact: true }).click();
  await expect(library.getByRole('alert')).toContainText('已有新修订');
  await expect(library.getByLabel('资产描述', { exact: true })).toHaveValue('Local unsaved description');
  await library.getByRole('button', { name: '载入最新资产', exact: true }).click();
  await expect(library.getByLabel('外观设定', { exact: true })).toHaveValue('Long hair');
  await expect(library).toContainText('当前卡引用');
  await library.getByRole('button', { name: '查看资产 v1', exact: true }).click();
  await expect(library.getByLabel('外观设定', { exact: true })).toHaveValue('Short hair');
  await expect(library.getByRole('button', { name: '保存资产版本', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await library.getByLabel('资产名称', { exact: true }).scrollIntoViewIfNeeded();
  expect(await library.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(library.getByRole('button', { name: '载入最新资产', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: 'test-results/entity-history-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await library.getByRole('button', { name: '载入最新资产', exact: true }).click();
  await expect(library.getByLabel('外观设定', { exact: true })).toHaveValue('Long hair');
  await expect(library.getByRole('button', { name: '保存资产版本', exact: true })).toBeEnabled();
  await library.locator('.dialog-body').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: 'test-results/entity-library-desktop.png' });
  await page.keyboard.press('Escape');
  await otherPage.keyboard.press('Escape');
  await page.getByRole('button', { name: '镜头提示词', exact: true }).click();
  await prompt.locator('.revision-item').first().click();
  await expect(prompt).toContainText('已有新修订');
  await expect(prompt.getByLabel('完整正向提示词', { exact: true })).toHaveValue(/Short hair/);
  await expect(prompt.getByLabel('完整正向提示词', { exact: true })).not.toHaveValue(/Long hair/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '资产引用', exact: true }).click();
  await expect(binding.getByLabel('已选资产引用')).toContainText('Mira · v1');
  await binding
    .getByLabel('已选资产引用')
    .locator('article')
    .filter({ hasText: 'Mira · v1' })
    .getByRole('button', { name: '移除此资产引用' })
    .click();
  await binding.getByLabel('引用资产', { exact: true }).selectOption({ label: '人物 · Mira' });
  await binding.getByLabel('引用修订', { exact: true }).selectOption({ label: 'v2 · 草稿' });
  await binding.getByRole('button', { name: '加入引用列表', exact: true }).click();
  await binding.getByRole('button', { name: '保存镜头资产引用', exact: true }).click();
  await expect(binding).not.toBeVisible();
  await page.getByRole('button', { name: '资产引用', exact: true }).click();
  await expect(binding.getByLabel('已选资产引用')).toContainText('Mira · v2');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '资产引用', exact: true })).toBeFocused();
}
