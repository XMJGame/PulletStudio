import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { createMediaFixtures } from '../fixtures/media-fixtures.mjs';

async function projectAction(page: Page, name: string) {
  await page.getByText('更多操作', { exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('asset-led studio initializes, imports media, preserves conflicts and restores a project', async ({
  page,
  browser,
}) => {
  test.setTimeout(45000);
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto('/');
  await page.getByLabel('初始化密钥').fill('playwright-local-test-setup-token-2026');
  await page.getByLabel('你的名字').fill('Creator');
  await page.getByLabel('邮箱', { exact: true }).fill('creator@studio.test');
  await page.getByLabel('密码', { exact: true }).fill('Studio8!');
  await page.getByLabel('工作区名称').fill('Creative studio');
  await page.getByRole('button', { name: '创建工作室' }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建项目', exact: true });
  await create.getByLabel('项目名称', { exact: true }).fill('A quiet station');
  await expect(create.getByLabel('项目编号', { exact: true })).toHaveCount(0);
  await create.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '从第一帧开始' })).toBeVisible();
  for (const name of ['兼容制作工具', '项目剧本', '制作结构', 'AI 分镜', '分集与镜头'])
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  expect(requests.some((path) => /\/(episodes|shots)$/.test(path))).toBeFalsy();
  const retired = await page.request.get('/canvas-lab.html');
  expect(await retired.text()).not.toContain('/src/canvas-lab/');
  const fixtures = await createMediaFixtures(
    resolve('test-results/creation-fixtures'),
    process.env.FFMPEG_PATH ||
      (process.platform === 'win32' ? resolve('data/tools/ffmpeg/bin/ffmpeg.exe') : 'ffmpeg'),
  );
  await projectAction(page, '打开素材库');
  const media = page.getByRole('dialog', { name: '项目素材', exact: true });
  await media
    .getByLabel('媒体文件', { exact: true })
    .setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: fixtures['image.png'].bytes });
  await media.getByRole('button', { name: '上传并归档', exact: true }).click();
  await expect(media.getByRole('status').filter({ hasText: '媒体已完成归档' })).toBeVisible();
  await expect(media.getByAltText('导入媒体预览')).toBeVisible();
  await expect(media.getByRole('button', { name: '添加为当前镜头候选', exact: true })).toHaveCount(0);
  await media.getByRole('button', { name: '关闭', exact: true }).click();
  await projectAction(page, '项目设置');
  await page.getByLabel('项目简介').fill('Local pending description');
  const second = await browser.newContext(),
    other = await second.newPage();
  await other.goto('/');
  await other.getByLabel('邮箱', { exact: true }).fill('creator@studio.test');
  await other.getByLabel('密码', { exact: true }).fill('Studio8!');
  await other.getByRole('button', { name: '登录工作室' }).click();
  await other.getByRole('button', { name: '打开项目 A quiet station', exact: true }).click();
  await projectAction(other, '项目设置');
  await other.getByLabel('项目简介').fill('Newer description');
  await other.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(other.getByRole('status')).toHaveText('项目资料已保存');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '项目设置' }).getByRole('alert')).toContainText('已被修改');
  await expect(page.getByLabel('项目简介')).toHaveValue('Local pending description');
  await page.getByRole('button', { name: '加载最新版本', exact: true }).click();
  await expect(page.getByLabel('项目简介')).toHaveValue('Newer description');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await second.close();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await projectAction(page, '项目设置');
  await page.getByRole('button', { name: '移入回收站', exact: true }).click();
  await page.getByRole('button', { name: '确认移入回收站', exact: true }).click();
  const trash = page.getByRole('dialog', { name: '移入项目回收站', exact: true });
  await expect(trash.getByRole('alert')).toContainText('已被修改');
  await trash.getByRole('button', { name: '刷新项目资料', exact: true }).click();
  await trash.getByRole('button', { name: '确认移入回收站', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
  await page.getByText('Creator', { exact: true }).click();
  await page.getByRole('button', { name: '项目回收站', exact: true }).click();
  await page.getByRole('button', { name: '恢复项目 A quiet station', exact: true }).click();
  await expect(page.getByRole('heading', { name: '从第一帧开始' })).toBeVisible();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.screenshot({ path: 'test-results/studio-live-gallery-mobile.png', fullPage: true });
  await page.getByText('Creator', { exact: true }).click();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill('creator@studio.test');
  await page.getByLabel('密码', { exact: true }).fill('Studio8!');
  await page.getByRole('button', { name: '登录工作室' }).click();
  await expect(page.getByRole('button', { name: '打开项目 A quiet station', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
