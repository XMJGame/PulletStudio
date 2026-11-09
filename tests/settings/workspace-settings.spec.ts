import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
let owner: APIRequestContext, setup: any;
async function call(method: string, path: string, data?: unknown) {
  const session = await (await owner.get('/api/v1/auth/me')).json();
  const response = await owner.fetch('/api/v1' + path, {
    method,
    data,
    headers: {
      'X-Studio-Request': '1',
      'X-CSRF-Token': session.csrfToken ?? '',
      'Idempotency-Key': randomUUID(),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test.beforeAll(async () => {
  owner = await request.newContext({ baseURL: 'http://127.0.0.1:5192' });
  const initialized = (await (await owner.get('/api/v1/setup/status')).json()).initialized;
  const response = await owner.post(initialized ? '/api/v1/auth/login' : '/api/v1/setup/initialize', {
    data: initialized
      ? { email: 'owner@workspace-settings.test', password: 'Studio8!' }
      : {
          setupToken: 'playwright-formal-boards-setup-2026',
          email: 'owner@workspace-settings.test',
          password: 'Studio8!',
          name: 'Settings owner',
          workspaceName: 'Settings acceptance',
        },
    headers: { 'X-Studio-Request': '1' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  setup = await response.json();
});
test.afterAll(async () => owner?.dispose());
async function enter(page: Page, workspaceId: string) {
  await page.context().addCookies((await owner.storageState()).cookies);
  await page.addInitScript(({ uid, wid }) => localStorage.setItem(`pullet.workspace.${uid}`, wid), {
    uid: setup.user.id,
    wid: workspaceId,
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  return page.getByRole('dialog', { name: '设置', exact: true });
}

test('global settings configure instances before any project and show only the selected item on the right', async ({
  page,
}) => {
  const workspace = await call('POST', '/workspaces', { name: 'Empty global settings' });
  const settings = await enter(page, workspace.id);
  await settings.getByRole('button', { name: '新增实例', exact: true }).click();
  await settings.getByLabel('实例名称', { exact: true }).fill('Global workstation');
  await settings.getByLabel('ComfyUI 地址', { exact: true }).fill('http://127.0.0.1:49999');
  await settings.getByLabel('批准自部署 HTTP 或私有网络地址').check();
  await settings.getByRole('button', { name: '添加实例', exact: true }).click();
  await expect(settings.getByRole('article', { name: '实例 Global workstation', exact: true })).toBeVisible();
  await expect(settings.getByRole('heading', { name: '添加实例', exact: true })).toBeHidden();
  const before = await call('GET', `/workspaces/${workspace.id}/generation-connections`);
  expect(before.connections).toHaveLength(1);
  await settings.getByRole('button', { name: '工作流', exact: true }).click();
  await expect(settings.getByText('工作流按项目管理', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '实例', exact: true }).click();
  await page.screenshot({ path: 'test-results/b13-instances-desktop.png' });
});

test('left navigation preserves instance API and workflow drafts and guards project switching', async ({
  page,
}) => {
  const workspace = await call('POST', '/workspaces', { name: 'Independent settings drafts' });
  const first = await call('POST', '/projects', {
    workspaceId: workspace.id,
    title: 'First workflow project',
  });
  const second = await call('POST', '/projects', {
    workspaceId: workspace.id,
    title: 'Second workflow project',
  });
  const settings = await enter(page, workspace.id);
  await settings.getByRole('button', { name: '新增实例', exact: true }).click();
  await settings.getByLabel('实例名称', { exact: true }).fill('Unsaved instance');
  await settings.getByRole('button', { name: 'ModelScope', exact: true }).click();
  await settings.getByLabel('文生图 API Key', { exact: true }).fill('fake-private-draft-key');
  await settings.getByRole('button', { name: 'Agnes AI', exact: true }).click();
  await expect(settings.getByLabel('文生图 API Key', { exact: true })).toBeHidden();
  await expect(settings.getByLabel('Agnes AI API Key', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'ModelScope', exact: true }).click();
  await expect(settings.getByLabel('文生图 API Key', { exact: true })).toHaveValue('fake-private-draft-key');
  await page.screenshot({ path: 'test-results/b13-api-desktop.png' });
  await settings.getByRole('button', { name: '工作流', exact: true }).click();
  await settings.getByLabel('工作流所属项目').selectOption(first.id);
  await settings.getByLabel('工作流名称', { exact: true }).fill('Unsaved workflow');
  await settings.getByRole('button', { name: '实例', exact: true }).click();
  await expect(settings.getByLabel('实例名称', { exact: true })).toHaveValue('Unsaved instance');
  await settings.getByRole('button', { name: '工作流', exact: true }).click();
  await settings.getByLabel('工作流所属项目').selectOption(second.id);
  const switching = page.getByRole('dialog', { name: '切换工作流项目', exact: true });
  await switching.getByRole('button', { name: '保留草稿', exact: true }).click();
  await expect(settings.getByLabel('工作流名称', { exact: true })).toHaveValue('Unsaved workflow');
  await settings.getByLabel('工作流所属项目').selectOption(second.id);
  await switching.getByRole('button', { name: '丢弃工作流草稿并切换', exact: true }).click();
  await expect(settings.getByLabel('工作流名称', { exact: true })).toHaveValue('');
  await settings.getByRole('button', { name: 'ModelScope', exact: true }).click();
  await expect(settings.getByLabel('文生图 API Key', { exact: true })).toHaveValue('fake-private-draft-key');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '离开设置', exact: true })).toBeVisible();
});

test('mobile settings navigate between list and details and preserve fields after a failed save', async ({
  page,
}) => {
  const workspace = await call('POST', '/workspaces', { name: 'Mobile global settings' });
  await page.addInitScript(() => localStorage.setItem('pullet.canvas.theme', 'dark'));
  await page.setViewportSize({ width: 390, height: 844 });
  const settings = await enter(page, workspace.id);
  await settings.getByRole('button', { name: '新增实例', exact: true }).click();
  await settings.getByLabel('实例名称', { exact: true }).fill('Mobile draft');
  await settings.getByLabel('ComfyUI 地址', { exact: true }).fill('http://127.0.0.1:49999');
  await settings.getByLabel('批准自部署 HTTP 或私有网络地址').check();
  await page.route(`**/workspaces/${workspace.id}/generation-connections`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'TEMPORARY', message: '实例暂时无法保存' }),
    });
  });
  await settings.getByRole('button', { name: '添加实例', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('实例暂时无法保存');
  await settings.getByRole('button', { name: '设置导航', exact: true }).click();
  await settings.getByRole('button', { name: 'ModelScope', exact: true }).click();
  await page.screenshot({ path: 'test-results/b13-api-mobile.png' });
  await settings.getByRole('button', { name: '设置导航', exact: true }).click();
  await settings.getByRole('button', { name: '实例', exact: true }).click();
  await settings.getByRole('button', { name: '当前配置', exact: true }).click();
  await expect(settings.getByLabel('实例名称', { exact: true })).toHaveValue('Mobile draft');
  await expect
    .poll(() => settings.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
});

test('ordinary members see no instance or API secrets in global settings', async ({ browser }) => {
  const workspace = await call('POST', '/workspaces', { name: 'Settings permissions' });
  await call('POST', `/workspaces/${workspace.id}/generation-connections`, {
    name: 'Private workstation',
    baseUrl: 'http://127.0.0.1:49999',
    trustedPrivate: true,
    token: 'fake-server-only-key',
  });
  const invite = await call('POST', `/workspaces/${workspace.id}/invitations`, {
    email: `settings-reader-${randomUUID()}@settings.test`,
  });
  const reader = await request.newContext({ baseURL: 'http://127.0.0.1:5192' });
  const accepted = await reader.post('/api/v1/invitations/accept', {
    data: { token: invite.token, name: 'Settings reader', password: 'Studio8!' },
    headers: { 'X-Studio-Request': '1' },
  });
  expect(accepted.ok()).toBeTruthy();
  const user = (await accepted.json()).user;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await context.addCookies((await reader.storageState()).cookies);
    const page = await context.newPage();
    await page.addInitScript(({ uid, wid }) => localStorage.setItem(`pullet.workspace.${uid}`, wid), {
      uid: user.id,
      wid: workspace.id,
    });
    await page.goto('/');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(settings.getByRole('button', { name: '新增实例', exact: true })).toHaveCount(0);
    await expect(settings.getByText('Private workstation', { exact: true })).toHaveCount(0);
    await settings.getByRole('button', { name: 'ModelScope', exact: true }).click();
    await expect(settings.getByText('API 配置需要工作区管理权限。', { exact: true })).toBeVisible();
    await expect(settings.getByLabel('文生图 API Key', { exact: true })).toHaveCount(0);
    const config = await reader.get(`/api/v1/workspaces/${workspace.id}/generation-connections`);
    expect((await config.json()).connections).toEqual([]);
  } finally {
    await context.close();
    await reader.dispose();
  }
});
