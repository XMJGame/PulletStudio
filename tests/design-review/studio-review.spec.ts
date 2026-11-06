import { expect, test, type Page } from '@playwright/test';

const destination = 'test-results/studio-ui-v2';
const review = '/studio-review.html';
async function snapshot(page: Page, name: string) {
  await page.screenshot({ path: `${destination}/${name}.png`, animations: 'disabled' });
}
async function noOverflow(page: Page) {
  expect(await page.locator('body').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
}

test('project gallery opens the actual blank canvas and supports resource insertion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(review);
  await expect(page.getByRole('heading', { name: '我的项目' })).toBeVisible();
  await snapshot(page, '01-projects');
  await page.getByRole('searchbox', { name: '搜索项目' }).fill('未命名');
  await page.getByRole('button', { name: /未命名试验/ }).click();
  await expect(page.getByRole('heading', { name: '从第一帧开始' })).toBeVisible();
  await snapshot(page, '02-empty-canvas');
  await page.getByRole('button', { name: '打开资源库', exact: true }).click();
  await page
    .getByRole('button', { name: '添加 海岸参考', exact: true })
    .dragTo(page.getByRole('main', { name: '无限画布' }), { targetPosition: { x: 290, y: 130 } });
  await expect(page.getByRole('img', { name: '海岸参考', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '素材预览' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '以此图生成', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '工作流' })).toHaveValue('i2v');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByRole('button', { name: '返回项目', exact: true }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称').fill('新的短片');
  await page.getByRole('button', { name: '创建并打开' }).click();
  await expect(page.getByRole('heading', { name: '从第一帧开始' })).toBeVisible();
});

test('seeded scene demonstrates settings, mock failure, generation, playback, and reuse', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${review}?scene=canvas`);
  const panel = page.getByRole('region', { name: '创作面板' });
  await expect(panel.getByRole('textbox', { name: '生成提示词' })).toHaveValue(/灯塔/);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await snapshot(page, '03-creation');
  await panel.getByText('16:9 · 5s', { exact: true }).click();
  await expect(panel.getByText('生成参数', { exact: true })).toBeVisible();
  await panel.getByLabel('模拟失败').check();
  await snapshot(page, '04-parameters');
  await panel.getByText('16:9 · 5s', { exact: true }).click();
  await panel.getByRole('button', { name: '生成', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('正在生成');
  await snapshot(page, '05-running');
  await expect(panel.getByRole('alert')).toContainText('提示词和参考图已保留');
  await expect(panel.getByRole('textbox', { name: '生成提示词' })).toHaveValue(/灯塔/);
  await snapshot(page, '06-failed');
  await panel.getByText('16:9 · 5s', { exact: true }).click();
  await panel.getByLabel('模拟失败').uncheck();
  await panel.getByText('16:9 · 5s', { exact: true }).click();
  await panel.getByRole('button', { name: '重试', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('候选已加入画布');
  await snapshot(page, '07-result');
  await page.getByRole('button', { name: '关闭创作面板' }).click();
  await page.getByRole('button', { name: '播放 潮汐以北 · 生成候选', exact: true }).click();
  const video = page.getByRole('dialog', { name: '素材预览' }).locator('video');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page
    .getByRole('img', { name: '潮汐以北 · 生成候选', exact: true })
    .click({ position: { x: 30, y: 50 } });
  await page.getByRole('button', { name: '存入资源库', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加 潮汐以北 · 生成候选', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复用封面帧', exact: true }).click();
  await expect(panel).toContainText('候选片段 · 封面帧');
  await page.getByRole('button', { name: '海岸光线', exact: true }).click();
  await page.getByRole('button', { name: '分镜探索', exact: true }).click();
  await expect(page.getByRole('heading', { name: '从第一帧开始' })).toBeVisible();
});

test('real browser captures three desktop sizes, dark and mobile, and checks zoom-equivalent widths', async ({
  page,
}) => {
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
    [1152, 720],
    [960, 600],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${review}?scene=canvas`);
    await noOverflow(page);
    await expect(page.getByRole('button', { name: '生成', exact: true })).toBeInViewport();
    await expect(page.getByRole('img', { name: '海岸参考', exact: true })).toBeInViewport();
    if ([1920, 1366, 390].includes(width)) await snapshot(page, `08-creation-${width}`);
    await page.getByRole('button', { name: '添加节点', exact: true }).click();
    await expect(page.getByRole('button', { name: '工作流生成', exact: true })).toBeInViewport();
    if (width === 390) {
      await page.getByRole('button', { name: '深色画布', exact: true }).click();
      await expect(page.locator('.studio-v2')).toHaveAttribute('data-theme', 'dark');
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${review}?scene=canvas&theme=dark`);
  await snapshot(page, '09-creation-dark');
});
