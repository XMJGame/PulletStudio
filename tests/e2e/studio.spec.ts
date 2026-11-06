import { selectLegacyView } from './legacy-navigation';
import { test, expect } from '@playwright/test';
import { exerciseScriptImport } from './script-import-flow';
import { exerciseProductionStructure } from './production-structure-flow';
import { exerciseTextAnalysis } from './text-analysis-flow';
import { exerciseProposalReview } from './proposal-review-flow';
import { exerciseTextDelivery } from './text-delivery-flow';
import { exerciseStoryboardExports } from './storyboard-export-flow';
import { exerciseMedia } from './media-flow';
import { exerciseEntities } from './entities-flow';
import { exerciseGeneration } from './generation-flow';

test('initialize, create a storyboard, keep conflicting edits, and sign back in', async ({
  page,
  browser,
}) => {
  test.setTimeout(75000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '创建你的工作室' })).toBeVisible();
  await page.getByLabel('初始化密钥').fill('playwright-local-test-setup-token-2026');
  await page.getByLabel('你的名字').fill('制片');
  await page.getByLabel('邮箱', { exact: true }).fill('producer@example.test');
  await page.getByLabel('密码', { exact: true }).fill('Studio8!');
  await page.getByLabel('工作区名称').fill('影像实验室');
  await page.getByRole('button', { name: '创建工作室' }).click();
  const switcher = page.getByRole('button', { name: '切换工作区：影像实验室' });
  await switcher.click();
  await expect(page.getByRole('menu', { name: '工作区菜单' })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: /影像实验室/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(switcher).toBeFocused();
  await switcher.click();
  await page.getByRole('heading', { name: '每个故事，都从这里开始' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const headingPosition = await page.getByRole('heading', { name: '每个故事，都从这里开始' }).boundingBox();
  await page.getByRole('button', { name: '创建第一个项目' }).click();
  const projectDialog = page.getByRole('dialog', { name: '新建项目' });
  await expect(projectDialog).toBeVisible();
  await expect(page.getByLabel('项目名称')).toBeFocused();
  expect(
    await page.getByRole('heading', { name: '每个故事，都从这里开始', includeHidden: true }).boundingBox(),
  ).toEqual(headingPosition);
  await page.getByLabel('项目名称').fill('取消测试');
  await page.keyboard.press('Escape');
  await expect(projectDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建第一个项目' })).toBeFocused();
  await page.getByRole('button', { name: '创建第一个项目' }).click();
  await expect(page.getByRole('radio', { name: '暂不设定' })).toBeChecked();
  await page.getByRole('radio', { name: '写实电影' }).check();
  await page.getByRole('button', { name: '补充风格描述（可选）' }).click();
  await page.getByLabel('风格补充说明').fill('柔和侧光、低饱和暖色、写实材质');
  await page.setViewportSize({ width: 977, height: 800 });
  const desktopSubmit = await projectDialog
    .getByRole('button', { name: '创建项目', exact: true })
    .boundingBox();
  expect(desktopSubmit!.y + desktopSubmit!.height).toBeLessThanOrEqual(800);
  await page.screenshot({ path: 'test-results/project-dialog-desktop.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/project-dialog-mobile.png', fullPage: true });
  const dialogBounds = await projectDialog.boundingBox();
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(390);
  const mobileSubmit = await projectDialog
    .getByRole('button', { name: '创建项目', exact: true })
    .boundingBox();
  expect(mobileSubmit!.y + mobileSubmit!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('项目名称').fill('补天计划');
  await expect(page.getByLabel('项目编号')).toHaveCount(0);
  await page.getByRole('radio', { name: '9:16 竖屏' }).check();
  await page.getByRole('button', { name: '关闭对话框' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '创建项目', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '补天计划' })).toBeVisible();
  await expect(page.locator('.page-heading')).toContainText('P0001');
  await expect(page.locator('.page-heading')).toContainText('写实电影');
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await expect(page.getByRole('radio', { name: '写实电影' })).toBeChecked();
  await expect(page.getByLabel('风格补充说明')).toHaveValue('柔和侧光、低饱和暖色、写实材质');
  await page.getByRole('radio', { name: '自定义', exact: true }).check();
  await page.getByLabel('自定义视觉风格描述').fill('');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '项目设置' })).toBeVisible();
  expect(
    await page
      .getByLabel('自定义视觉风格描述')
      .evaluate((element: HTMLTextAreaElement) => element.validity.valueMissing),
  ).toBe(true);
  await page.getByLabel('自定义视觉风格描述').fill('纸雕层次、低饱和青绿、柔和边缘光');
  await page.getByLabel('项目简介').fill('女娲补天的影像创作项目');
  await page.getByRole('radio', { name: '16:9 横屏' }).check();
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('项目资料已保存');
  await expect(page.locator('.page-heading')).toContainText('16:9');
  await expect(page.locator('.page-heading')).toContainText('自定义');
  await selectLegacyView(page);
  await page.getByRole('button', { name: '新建分集' }).click();
  await page.getByLabel('分集名称').fill('裂开的天空');
  await expect(page.getByLabel('分集编号')).toHaveCount(0);
  await page.getByRole('button', { name: '创建分集' }).click();
  await page.getByRole('button', { name: '编辑当前分集' }).click();
  await expect(page.getByLabel('分集编号')).toHaveAttribute('readonly', '');
  await page.getByLabel('分集名称').fill('裂开的天空（修订）');
  await page.getByLabel('排列顺序').fill('2');
  await page.getByRole('button', { name: '保存分集', exact: true }).click();
  await expect(page.getByRole('tab', { name: /裂开的天空（修订）/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: '新建镜头' }).click();
  await expect(page.getByLabel('镜头编号')).toHaveCount(0);
  await page.getByLabel('画面描述').fill('女娲看向裂开的天空');
  await page.getByRole('button', { name: '创建镜头', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SH001' })).toBeVisible();
  await expect(page.getByLabel('镜头编号')).toHaveAttribute('readonly', '');
  await page.getByLabel('运镜与景别').fill('中景，缓慢推进');
  await page.getByRole('button', { name: '保存镜头' }).click();
  await expect(page.getByRole('status')).toHaveText('镜头已保存');
  await page.reload();
  await selectLegacyView(page);
  await page.locator('.shot-card').click();
  await expect(page.getByLabel('运镜与景别')).toHaveValue('中景，缓慢推进');
  const second = await browser.newContext();
  const otherPage = await second.newPage();
  await otherPage.goto('/');
  await otherPage.getByLabel('邮箱', { exact: true }).fill('producer@example.test');
  await otherPage.getByLabel('密码', { exact: true }).fill('Studio8!');
  await otherPage.getByRole('button', { name: '登录工作室' }).click();
  await selectLegacyView(otherPage);
  await otherPage.locator('.shot-card').click();
  await otherPage.getByLabel('画面描述').fill('另一个窗口的最新描述');
  await otherPage.getByRole('button', { name: '保存镜头' }).click();
  await expect(otherPage.getByRole('status')).toHaveText('镜头已保存');
  await page.getByLabel('画面描述').fill('尚未保存的本地修改');
  await page.getByRole('button', { name: '保存镜头' }).click();
  await expect(page.getByRole('alert')).toContainText('已被修改');
  await expect(page.getByLabel('画面描述')).toHaveValue('尚未保存的本地修改');
  await page.getByRole('button', { name: '加载最新版本' }).click();
  await expect(page.getByLabel('画面描述')).toHaveValue('另一个窗口的最新描述');
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await expect(page.getByLabel('自定义视觉风格描述')).toHaveValue('纸雕层次、低饱和青绿、柔和边缘光');
  await page.getByLabel('项目简介').fill('本地项目修改');
  await otherPage.getByRole('button', { name: '项目设置', exact: true }).click();
  await otherPage.getByLabel('项目简介').fill('另一个窗口更新的项目资料');
  await otherPage.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(otherPage.getByRole('status')).toHaveText('项目资料已保存');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '项目设置' }).getByRole('alert')).toContainText('已被修改');
  await expect(page.getByLabel('项目简介')).toHaveValue('本地项目修改');
  await page.getByRole('dialog', { name: '项目设置' }).getByRole('button', { name: '加载最新版本' }).click();
  await expect(page.getByLabel('项目简介')).toHaveValue('另一个窗口更新的项目资料');
  await page.getByRole('button', { name: '取消', exact: true }).click();

  // Scripts preserve revisions, conflicting inputs and this tab's unsaved draft.
  await selectLegacyView(page, '项目剧本');
  await page.getByLabel('剧本标题').fill('补天 · 项目剧本');
  await page.getByLabel('剧本正文').fill('第一幕：天空裂开。\n女娲抬头，五色石散落在河岸。');
  await page.getByLabel('本次修改说明').fill('故事初稿');
  await page.getByRole('button', { name: '保存剧本版本' }).click();
  await expect(page.getByRole('status')).toHaveText('剧本已保存为 v1');
  await selectLegacyView(otherPage, '项目剧本');
  await expect(otherPage.getByLabel('剧本正文')).toHaveValue(
    '第一幕：天空裂开。\n女娲抬头，五色石散落在河岸。',
  );
  await page.getByLabel('剧本正文').fill('第二稿：女娲决定收集五色石，修补裂开的天空。');
  await page.getByLabel('本次修改说明').fill('补充主角行动');
  await page.getByRole('button', { name: '保存剧本版本' }).click();
  await expect(page.getByRole('status')).toHaveText('剧本已保存为 v2');
  await otherPage.getByLabel('剧本正文').fill('另一个窗口尚未保存的剧本');
  await otherPage.getByRole('button', { name: '保存剧本版本' }).click();
  await expect(otherPage.getByRole('alert')).toContainText('已被修改');
  await expect(otherPage.getByLabel('剧本正文')).toHaveValue('另一个窗口尚未保存的剧本');
  await otherPage.getByRole('button', { name: '载入最新剧本' }).click();
  await page
    .locator('.revision-item')
    .filter({ has: page.getByText('v1', { exact: true }) })
    .click();
  await expect(page.getByLabel('历史剧本内容')).toHaveValue(
    '第一幕：天空裂开。\n女娲抬头，五色石散落在河岸。',
  );
  await page.getByRole('button', { name: '恢复为新版本' }).click();
  await expect(page.getByRole('status')).toContainText('保存为 v3');
  await expect(page.locator('.revision-item')).toHaveCount(3);
  await page.getByLabel('剧本正文').fill('本窗口还未提交的改动');
  await selectLegacyView(page, '分集与镜头');
  await selectLegacyView(page, '项目剧本');
  await expect(page.getByLabel('剧本正文')).toHaveValue('本窗口还未提交的改动');
  await page.reload();
  await selectLegacyView(page, '项目剧本');
  await selectLegacyView(page, '项目剧本');
  await expect(page.getByLabel('剧本正文')).toHaveValue('本窗口还未提交的改动');
  await page.getByRole('button', { name: '载入最新剧本' }).click();
  await expect(page.getByLabel('剧本正文')).toHaveValue('第一幕：天空裂开。\n女娲抬头，五色石散落在河岸。');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/script-workbench-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/script-workbench-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectLegacyView(page, '分集与镜头');
  await page.locator('.shot-card').click();
  await selectLegacyView(otherPage, '分集与镜头');
  // Exercise the actual invitation and project-role UI, with a separate browser account.
  await page.getByRole('button', { name: '团队协作' }).click();
  await page.getByLabel('邀请邮箱').fill('editor-browser@example.test');
  await page.getByRole('button', { name: '生成邀请' }).click();
  const invitation = await page.getByLabel('邀请令牌（仅显示本次）').inputValue();
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto('/');
  await memberPage.getByRole('button', { name: '收到邀请？加入工作区' }).click();
  await memberPage.getByLabel('邀请令牌', { exact: true }).fill(invitation);
  await memberPage.getByLabel('你的名字').fill('镜头编辑');
  await memberPage.getByLabel('密码', { exact: true }).fill('Member123456789!');
  await memberPage.getByRole('button', { name: '加入工作区' }).click();
  await expect(memberPage.getByText('你的项目会出现在这里')).toBeVisible();
  await page.getByRole('button', { name: '刷新成员' }).click();
  await page.getByLabel('项目成员').selectOption({ label: '镜头编辑 · editor-browser@example.test' });
  await page.getByLabel('项目角色').selectOption('VIEWER');
  await page.getByRole('button', { name: '分配角色' }).click();
  await expect(page.getByRole('status')).toHaveText('项目角色已保存');
  await memberPage.reload();
  await selectLegacyView(memberPage);
  await memberPage.locator('.shot-card').click();
  await expect(memberPage.getByRole('button', { name: '保存镜头' })).toBeDisabled();
  await expect(memberPage.getByRole('button', { name: '新建镜头' })).toHaveCount(0);
  await selectLegacyView(memberPage, '项目剧本');
  await expect(memberPage.getByLabel('剧本正文')).toHaveAttribute('readonly', '');
  await expect(memberPage.getByRole('button', { name: '保存剧本版本' })).toHaveCount(0);
  await page.getByLabel('项目角色').selectOption('EDITOR');
  await page.getByRole('button', { name: '分配角色' }).click();
  await expect(page.getByRole('status')).toHaveText('项目角色已保存');
  await memberPage.reload();
  await selectLegacyView(memberPage);
  await memberPage.locator('.shot-card').click();
  await expect(memberPage.getByRole('button', { name: '保存镜头' })).toBeEnabled();
  await memberPage.getByLabel('对白 / 旁白').fill('天，还没有塌。');
  await memberPage.getByRole('button', { name: '保存镜头' }).click();
  await expect(memberPage.getByRole('status')).toHaveText('镜头已保存');
  await page.getByLabel('调整项目身份：镜头编辑').selectOption('REVIEWER');
  await page.getByRole('button', { name: '保存项目身份：镜头编辑', exact: true }).click();
  await expect(page.getByLabel('调整项目身份：镜头编辑')).toHaveValue('REVIEWER');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/team-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '移出项目：镜头编辑', exact: true }).click();
  await expect(page.getByRole('group', { name: '移除成员确认' })).toBeFocused();
  await page.getByRole('button', { name: '确认移除成员', exact: true }).click();
  await expect(page.getByLabel('调整项目身份：镜头编辑')).toHaveCount(0);
  await memberPage.reload();
  await expect(memberPage.getByText('你的项目会出现在这里')).toBeVisible();
  await page.getByRole('button', { name: '移出工作区：镜头编辑', exact: true }).click();
  await page.getByRole('button', { name: '确认移除成员', exact: true }).click();
  await expect(page.getByRole('button', { name: '移出工作区：镜头编辑', exact: true })).toHaveCount(0);
  await memberPage.reload();
  await expect(memberPage.getByRole('button', { name: '切换工作区：选择工作区' })).toBeVisible();
  await memberContext.close();
  await page.getByRole('dialog', { name: '团队协作' }).getByRole('button', { name: '关闭对话框' }).click();
  await page.getByRole('button', { name: '加载最新版本' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/storyboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'SH001' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/storyboard-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 977, height: 800 });
  await switcher.click();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: '加入工作区' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitemradio', { name: /影像实验室/ })).toBeFocused();
  await page.screenshot({ path: 'test-results/workspace-menu-desktop.png', fullPage: true });
  await page.getByRole('menuitem', { name: '新建工作区' }).click();
  await expect(page.getByRole('dialog', { name: '新建工作区' })).toBeVisible();
  await page.getByLabel('工作区名称').fill('第二创作团队');
  await expect(page.getByLabel('工作区标识')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/workspace-create-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '创建工作区', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换工作区：第二创作团队' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '每个故事，都从这里开始' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '切换工作区：第二创作团队' }).click();
  await page.getByRole('menuitemradio', { name: /影像实验室/ }).click();
  await expect(page.getByRole('heading', { name: '补天计划' })).toBeVisible();
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await page.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '移入项目回收站' })).toBeVisible();
  await page.getByRole('button', { name: '确认移入回收站', exact: true }).click();
  await expect(page.getByRole('heading', { name: '每个故事，都从这里开始' })).toBeVisible();
  await page.getByRole('button', { name: '项目回收站', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '项目回收站' }).getByText('补天计划', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/trash-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '恢复项目 补天计划', exact: true }).click();
  await selectLegacyView(page);
  await expect(page.getByRole('heading', { name: '补天计划' })).toBeVisible();
  await expect(page.getByText('EP01', { exact: false }).first()).toBeVisible();
  await page.setViewportSize({ width: 977, height: 800 });
  await switcher.click();
  await page.getByRole('menuitem', { name: '加入工作区' }).click();
  await expect(page.getByRole('dialog', { name: '加入工作区' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '继续你的创作' })).toBeVisible();
  await page.getByLabel('邮箱', { exact: true }).fill('producer@example.test');
  await page.getByLabel('密码', { exact: true }).fill('Studio8!');
  await page.getByRole('button', { name: '登录工作室' }).click();
  await expect(page.getByRole('heading', { name: '补天计划' })).toBeVisible();
  expect(errors).toEqual([]);
  await selectLegacyView(page);
  await exerciseScriptImport(page, otherPage);
  await exerciseProductionStructure(page, otherPage);
  await exerciseTextAnalysis(page);
  await exerciseProposalReview(page, otherPage);
  await exerciseTextDelivery(page, otherPage);
  await exerciseStoryboardExports(page, otherPage);
  await exerciseMedia(page);
  await exerciseEntities(page, otherPage);
  await exerciseGeneration(page);
  expect(errors).toEqual([]);
  await second.close();
});
