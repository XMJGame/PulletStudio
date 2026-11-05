import { expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startComfyMock, fixtureWorkflow } from '../fixtures/comfy-mock.mjs';

export async function exerciseGeneration(page: Page) {
  const image = await readFile('test-results/media-fixtures/image.png');
  const remote = await startComfyMock({ 'image.png': image });
  try {
    // The preceding asset approval scenario leaves SH001 intentionally blocked.
    await page.locator('.structure-shot-list button').filter({ hasText: 'SH002' }).click();
    await page.getByRole('button', { name: '编辑完整制作卡', exact: true }).click();
    const card = page.getByRole('dialog', { name: '编辑完整制作卡' });
    await card.getByLabel('制作卡计划时长（秒）').fill('3');
    await card.getByRole('button', { name: '保存完整制作卡', exact: true }).click();
    await expect(card).not.toBeVisible();
    await page.getByRole('button', { name: '镜头提示词', exact: true }).click();
    const prompt = page.getByRole('dialog', { name: '镜头提示词' });
    await prompt.getByRole('button', { name: '预览完整提示词', exact: true }).click();
    await expect(prompt.getByLabel('完整正向提示词')).not.toHaveValue('');
    await prompt.getByRole('button', { name: '保存提示词快照', exact: true }).click();
    await expect(prompt.getByRole('status')).toContainText('提示词快照已保存');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '媒体生成', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '镜头媒体生成' });
    await dialog.getByText('配置 ComfyUI 连接与工作流', { exact: true }).click();
    await dialog.getByLabel('连接名称', { exact: true }).fill('ComfyUI fixture');
    await dialog.getByLabel('ComfyUI 基础地址', { exact: true }).fill(remote.baseUrl);
    await dialog.getByLabel('批准自部署 HTTP 或私有网络地址').check();
    await dialog.getByRole('button', { name: '添加连接', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('已添加生成连接');
    await dialog.getByRole('button', { name: '测试连接', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('ComfyUI 可达');
    await dialog.getByLabel('工作流名称').fill('Studio image fixture');
    await dialog.getByLabel('工作流连接').selectOption({ label: 'ComfyUI fixture' });
    await dialog.getByLabel('API 格式工作流 JSON').fill(JSON.stringify(fixtureWorkflow('').graph));
    await dialog.getByLabel('正向文本节点').fill('1');
    await dialog.getByLabel('输出节点').fill('3');
    await dialog.getByRole('button', { name: '验证绑定并保存', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('工作流的绑定节点已验证');
    await dialog.getByLabel('生成工作流', { exact: true }).selectOption({ index: 1 });
    await dialog.getByLabel('已保存提示词', { exact: true }).selectOption({ index: 1 });
    await dialog.getByRole('button', { name: '核对提示词', exact: true }).click();
    await expect(dialog.getByLabel('正向提示词', { exact: true })).not.toHaveValue('');
    const submit = dialog.getByRole('button', { name: '加入生成队列', exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('确认发送所选提示词到该工作流并消耗生成资源').check();
    await page.setViewportSize({ width: 390, height: 844 });
    await submit.scrollIntoViewIfNeeded();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/generation-mobile.png' });
    await submit.click();
    await expect(dialog.getByText('已归档为镜头候选', { exact: true })).toBeVisible({ timeout: 15000 });
    expect(remote.mock.submissions).toHaveLength(1);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('link', { name: '下载生成原件' }).click(),
    ]);
    expect(await readFile((await download.path())!)).toEqual(image);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '媒体生成', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '镜头素材', exact: true }).click();
    const media = page.getByRole('dialog', { name: '镜头素材与候选' });
    await expect(media.getByRole('button', { name: /查看候选 Take 01 · image.png/ })).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    await remote.close();
  }
}
