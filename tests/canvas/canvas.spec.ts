import { test, expect, Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createMediaFixtures } from '../fixtures/media-fixtures.mjs';
import { resolve } from 'node:path';

const storageKey = 'pullet:canvas-lab:layout:v1';
const sampleVideo = resolve('test-results/canvas-fixtures');
test.beforeAll(async () => {
  const ffmpeg =
    process.env.FFMPEG_PATH ||
    (process.platform === 'win32' ? resolve('data/tools/ffmpeg/bin/ffmpeg.exe') : 'ffmpeg');
  await createMediaFixtures(sampleVideo, ffmpeg);
});
async function saved(page: Page) {
  await page.getByRole('button', { name: '保存本机布局', exact: true }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}
async function openEngine(page: Page, engine: 'flow' | 'dom') {
  await page.goto('/canvas-lab.html');
  await page.getByText('原型对比与布局文件', { exact: true }).click();
  await page.getByLabel('画布底座', { exact: true }).selectOption(engine);
  await expect(page.getByRole('region', { name: '创作画布工作区', exact: true })).toHaveAttribute(
    'data-engine',
    engine,
  );
  await expect(page.locator('.lab-card').first()).toBeVisible();
}
async function drag(page: Page, locator: ReturnType<Page['locator']>, dx: number, dy: number) {
  const box = (await locator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + 24 + dy, { steps: 12 });
  await page.mouse.up();
}
for (const engine of ['flow', 'dom'] as const) {
  test(`${engine}: edit, connect, select, restore and play without production requests`, async ({ page }) => {
    const errors: string[] = [],
      requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('/api/')) requests.push(request.url());
    });
    await openEngine(page, engine);
    const before = await saved(page);
    expect(before.nodes).toHaveLength(30);
    await drag(page, page.locator('.lab-card').filter({ hasText: '参考图 1' }), 55, 30);
    const moved = await saved(page);
    expect(moved.nodes[0].position.x).toBeGreaterThan(before.nodes[0].position.x + 40);
    await page.locator('.lab-card').filter({ hasText: '提示词 1' }).click();
    const text = page.getByRole('textbox', { name: '提示词内容', exact: true });
    await text.fill('光线与服装保持一致');
    await text.press('End');
    await text.press('Space');
    await text.pressSequentially('morning light');
    await expect(text).toHaveValue('光线与服装保持一致 morning light');
    await text.press('ArrowLeft');
    await text.press('Delete');
    await expect(text).toHaveValue('光线与服装保持一致 morning ligh');
    await page.getByLabel('参考图 1 输出', { exact: true }).click();
    await page.getByLabel('生成配置 1 输入', { exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('已经存在');
    await page.getByLabel('参考图 1 输出', { exact: true }).click();
    await page.getByLabel('提示词 1 输入', { exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('类型不匹配');
    await page.getByLabel('结果比较 1 输出', { exact: true }).click();
    await page.getByLabel('生成配置 1 输入', { exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('循环');
    await page.locator('.lab-card').filter({ hasText: '结果比较 1' }).click();
    await page.getByRole('button', { name: '设为主方案 3', exact: true }).click();
    await expect(page.getByRole('button', { name: '✓ 主方案 3', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.screenshot({ path: `test-results/canvas-${engine}-overview.png` });
    const originalEdges = before.edges.length;
    await page.getByRole('button', { name: '断开 e2-3', exact: true }).click();
    await page.getByLabel('生成配置 1 输出', { exact: true }).click();
    await page.getByLabel('结果比较 1 输入', { exact: true }).click();
    expect((await saved(page)).edges).toHaveLength(originalEdges);
    const snapshot = await saved(page);
    await page.reload();
    await expect(page.locator('.lab-card').first()).toBeVisible();
    expect((await saved(page)).nodes.find((node: { id: string }) => node.id === 'n2').data.text).toBe(
      '光线与服装保持一致 morning ligh',
    );
    await page.evaluate((key) => localStorage.setItem(key, '{"schema":"bad","nodes":[]}'), storageKey);
    await page.getByRole('button', { name: '恢复布局', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('布局版本');
    expect((await saved(page)).nodes).toEqual(snapshot.nodes);
    await page.getByText('原型对比与布局文件', { exact: true }).click();
    await page.getByLabel('画布底座', { exact: true }).selectOption(engine);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出实验布局JSON', exact: true }).click(),
    ]);
    const exported = await readFile((await download.path())!, 'utf8');
    expect(exported).not.toContain('blob:');
    await page
      .getByLabel('导入实验布局', { exact: true })
      .setInputFiles({ name: 'layout.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    const area = (await page.getByRole('region', { name: '创作画布工作区', exact: true }).boundingBox())!;
    await page.mouse.move(area.x + 12, area.y + 65);
    await page.mouse.down();
    await page.mouse.move(area.x + 480, area.y + 460, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.lab-inspector-heading>span')).toHaveText(/选中 [2-9]/);
    await page.getByRole('button', { name: '＋ 提示词', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '节点名称', exact: true })).toHaveValue('新的提示词');
    expect((await saved(page)).nodes).toHaveLength(31);
    await page.getByRole('button', { name: '移除选中节点', exact: true }).click();
    expect((await saved(page)).nodes).toHaveLength(30);
    await page.getByRole('button', { name: '缩小画布', exact: true }).click();
    await page.getByRole('button', { name: '缩小画布', exact: true }).click();
    const videoCard = page.locator('.lab-card').filter({ hasText: '视频 1' });
    await videoCard.click();
    await page.getByLabel('本地预览文件', { exact: true }).setInputFiles(resolve(sampleVideo, 'clip.mp4'));
    const player = page.locator('.lab-inspector video');
    await player.evaluate(async (video: HTMLVideoElement) => {
      video.muted = true;
      await video.play();
    });
    await expect
      .poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(0.1);
    await player.evaluate((video: HTMLVideoElement) => video.pause());
    expect(JSON.stringify(await saved(page))).not.toContain('blob:');
    await page.screenshot({ path: `test-results/canvas-${engine}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/canvas-${engine}-mobile.png` });
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });

  for (const count of [30, 50] as const) {
    test(`${engine}: ${count} mixed nodes under active viewport interaction`, async ({ page }) => {
      await openEngine(page, engine);
      await page.getByRole('button', { name: `${count}节点样例`, exact: true }).click();
      await page.getByRole('button', { name: '查看全图', exact: true }).click();
      await page.getByRole('button', { name: '观察4秒交互性能', exact: true }).click();
      const stage = page.getByRole('region', { name: '创作画布工作区', exact: true });
      const bounds = (await stage.boundingBox())!;
      const until = Date.now() + 4100;
      for (let i = 0; Date.now() < until; i++) {
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.getByRole('button', { name: '放大画布', exact: true }).click();
        await page.mouse.down({ button: 'middle' });
        await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 + 20, {
          steps: 15,
        });
        await page.mouse.up({ button: 'middle' });
        await page.getByRole('button', { name: '缩小画布', exact: true }).click();
        await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 + 20);
        await page.mouse.down({ button: 'middle' });
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 15 });
        await page.mouse.up({ button: 'middle' });
      }
      await expect(page.getByTestId('performance-report')).toBeVisible({ timeout: 10000 });
      const report = JSON.parse((await page.getByTestId('performance-report').textContent())!);
      expect(report.nodes).toBe(count);
      expect(report.samples).toBeGreaterThan(30);
      expect(report.activeSamples).toBeGreaterThan(30);
      expect(report.interactionEvents).toBeGreaterThan(10);
      expect(report.frameP95Ms).toBeGreaterThan(0);
      await mkdir('test-results/canvas-performance', { recursive: true });
      await writeFile(
        `test-results/canvas-performance/${engine}-${count}.json`,
        JSON.stringify(report, null, 2),
      );
    });
  }
}
