import { expect, test, request, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { startComfyMock, fixtureWorkflow } from '../fixtures/comfy-mock.mjs';
let owner: APIRequestContext, setup: any, remote: Awaited<ReturnType<typeof startComfyMock>>;
async function api(method: string, path: string, data?: unknown, actor = owner) {
  const session = await (await actor.get('/api/v1/auth/me')).json();
  const response = await actor.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: {
      'X-Studio-Request': '1',
      'X-CSRF-Token': session.csrfToken ?? '',
      'Idempotency-Key': randomUUID(),
    },
  });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
test.beforeAll(async () => {
  owner = await request.newContext({ baseURL: 'http://127.0.0.1:5192' });
  const initialized = (await (await owner.get('/api/v1/setup/status')).json()).initialized;
  const response = await owner.post(`/api/v1${initialized ? '/auth/login' : '/setup/initialize'}`, {
    data: initialized
      ? { email: 'creator@workflow.test', password: 'Studio8!' }
      : {
          setupToken: 'playwright-formal-boards-setup-2026',
          email: 'creator@workflow.test',
          password: 'Studio8!',
          name: 'Creator',
          workspaceName: 'Workflow team',
        },
    headers: { 'X-Studio-Request': '1' },
  });
  expect(response.ok()).toBeTruthy();
  setup = await response.json();
  if (initialized) setup.workspace = (await api('GET', '/workspaces'))[0];
  remote = await startComfyMock({});
});
test.afterAll(async () => {
  await owner?.dispose();
  await remote?.close();
});
async function project(title: string) {
  return api('POST', '/projects', { workspaceId: setup.workspace.id, title });
}
async function open(page: Page, value: any, actor = owner, userId = setup.user.id) {
  await page.context().addCookies((await actor.storageState()).cookies);
  await page.addInitScript(
    ({ uid, wid, pid }) => {
      localStorage.setItem(`pullet.workspace.${uid}`, wid);
      localStorage.setItem(`pullet.project.${uid}.${wid}`, pid);
    },
    { uid: userId, wid: setup.workspace.id, pid: value.id },
  );
  await page.goto('/');
  await page.getByRole('button', { name: '工作流中心', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '工作流中心', exact: true })).toBeVisible();
}
test('project workflow center imports, visualizes and maps existing API fields without submitting generation', async ({
  page,
}) => {
  const value = await project('Workflow setup');
  await open(page, value);
  const dialog = page.getByRole('dialog', { name: '工作流中心', exact: true });
  await dialog.getByLabel('连接名称', { exact: true }).fill('Local validation fixture');
  await dialog.getByLabel('ComfyUI 基础地址', { exact: true }).fill(remote.baseUrl);
  await dialog.getByLabel('批准自部署 HTTP 或私有网络地址').check();
  await dialog.getByRole('button', { name: '添加连接', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('已添加生成连接');
  const graph = fixtureWorkflow('').graph,
    content = JSON.stringify(graph),
    requests = remote.mock.requests.length;
  await dialog.getByLabel('工作流名称', { exact: true }).fill('Mapped studio workflow');
  await dialog.getByLabel('工作流连接', { exact: true }).selectOption({ label: 'Local validation fixture' });
  await dialog
    .getByLabel('选择 API 格式 JSON 文件', { exact: true })
    .setInputFiles({ name: 'workflow-api.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  await dialog.getByRole('button', { name: '预览节点图', exact: true }).click();
  await expect(dialog.locator('.react-flow__node')).toHaveCount(3);
  await expect(dialog.locator('.react-flow__edge')).toHaveCount(1);
  expect(remote.mock.requests.length).toBe(requests);
  await dialog.locator('.react-flow__node[data-id="1"]').click();
  await dialog.getByLabel('节点常量输入', { exact: true }).selectOption('text');
  await dialog.getByRole('button', { name: '设为正向文本', exact: true }).click();
  await expect(dialog.getByLabel('正向文本节点', { exact: true })).toHaveValue('1');
  await dialog.getByLabel('选择工作流节点', { exact: true }).selectOption('2');
  await dialog.getByLabel('节点常量输入').selectOption('text');
  await dialog.getByRole('button', { name: '设为负向文本' }).click();
  await expect(dialog.getByLabel('负向文本节点（可选）')).toHaveValue('2');
  await expect(dialog.getByLabel('负向文本输入（可选）')).toHaveValue('text');
  // An invalid output is rejected by existing server/object_info validation, retaining all draft fields.
  await dialog.getByRole('button', { name: '设为输出节点' }).click();
  await dialog.getByRole('button', { name: '验证绑定并保存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('API 格式工作流 JSON', { exact: true })).toHaveValue(content);
  await expect(dialog.getByLabel('工作流名称', { exact: true })).toHaveValue('Mapped studio workflow');
  await dialog.getByLabel('选择工作流节点', { exact: true }).selectOption('3');
  await dialog.getByRole('button', { name: '设为输出节点' }).click();
  await page.screenshot({ path: 'test-results/workflow-center-desktop.png' });
  await dialog.getByRole('button', { name: '验证绑定并保存', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('工作流的绑定节点已验证并保存');
  await expect(dialog.getByRole('region', { name: '已保存的工作流' })).toContainText(
    'Mapped studio workflow',
  );
  expect(remote.mock.submissions).toHaveLength(0);
  expect(remote.mock.requests.some((path) => path.startsWith('/object_info/'))).toBeTruthy();
  await dialog.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '工作流中心', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '已保存的工作流' })).toContainText(
    'Mapped studio workflow',
  );
});
test('readonly users see existing workflow summaries without connection credentials or configuration controls', async ({
  page,
}) => {
  const value = await project('Readonly workflows');
  const connection = await api('POST', `/projects/${value.id}/generation-connections`, {
    name: 'Hidden endpoint',
    baseUrl: remote.baseUrl,
    trustedPrivate: true,
    token: 'fixture-secret-only',
  });
  const definition = fixtureWorkflow(connection.id);
  definition.name = 'Shared workflow summary';
  await api('POST', `/projects/${value.id}/generation-workflows`, definition);
  const reader = await request.newContext({ baseURL: 'http://127.0.0.1:5192' });
  try {
    const invite = await api('POST', `/workspaces/${setup.workspace.id}/invitations`, {
      email: 'viewer@workflow.test',
    });
    const accepted = await reader.post('/api/v1/invitations/accept', {
      data: { token: invite.token, name: 'Viewer', password: 'Studio8!' },
      headers: { 'X-Studio-Request': '1' },
    });
    const joined = await accepted.json();
    expect(accepted.ok()).toBeTruthy();
    await api('POST', `/projects/${value.id}/members`, { userId: joined.user.id, role: 'VIEWER' });
    await open(page, value, reader, joined.user.id);
    const dialog = page.getByRole('dialog', { name: '工作流中心', exact: true });
    await expect(dialog).toContainText('Shared workflow summary');
    await expect(dialog.getByLabel('ComfyUI 基础地址', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '验证绑定并保存' })).toHaveCount(0);
    const config = await api('GET', `/projects/${value.id}/generation-config`, undefined, reader);
    expect(config.canConfigure).toBeFalsy();
    expect(config.connections).toEqual([]);
    expect(JSON.stringify(config)).not.toContain('fixture-secret-only');
    expect(JSON.stringify(config)).not.toContain(remote.baseUrl);
    await api('DELETE', `/projects/${value.id}/members/${joined.user.id}`, { expectedRole: 'VIEWER' });
    await dialog.getByRole('button', { name: '刷新列表' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).not.toContainText('Shared workflow summary');
  } finally {
    await reader.dispose();
  }
});
test('invalid files preserve drafts; untrusted graph text never becomes external media or executable HTML', async ({
  page,
}) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on('pageerror', (reason) => errors.push(reason.message));
  page.on('request', (req) => {
    if (req.url().includes('untrusted.invalid')) external.push(req.url());
  });
  await open(page, await project('Safe technical preview'));
  const dialog = page.getByRole('dialog', { name: '工作流中心', exact: true });
  const graph = {
      a: {
        class_type: '<img onerror=alert(1)>',
        inputs: { text: 'https://untrusted.invalid/image.png', loop: ['b', 0] },
      },
      b: { class_type: 'Example', inputs: { source: ['a', 0], missing: ['absent', 0] } },
    },
    content = JSON.stringify(graph);
  await dialog.getByLabel('API 格式工作流 JSON', { exact: true }).fill(content);
  await dialog.getByRole('button', { name: '预览节点图' }).click();
  await expect(dialog.getByRole('region', { name: 'API工作流技术预览' })).toContainText('循环');
  await expect(dialog.getByRole('region', { name: 'API工作流技术预览' })).toContainText('缺失节点');
  await expect(dialog.locator('.workflow-technical-surface img')).toHaveCount(0);
  await dialog.getByLabel('选择 API 格式 JSON 文件', { exact: true }).setInputFiles({
    name: 'ui-layout.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"nodes":[],"links":[]}'),
  });
  await expect(dialog.getByRole('alert')).toContainText('API');
  await expect(dialog.getByLabel('API 格式工作流 JSON', { exact: true })).toHaveValue(content);
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByLabel('选择工作流节点').selectOption('a');
  await dialog.getByLabel('节点常量输入').selectOption('text');
  await dialog.getByRole('button', { name: '设为正向文本' }).click();
  await page.screenshot({ path: 'test-results/workflow-center-mobile.png' });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await dialog.getByRole('button', { name: '关闭工作流中心' }).click();
  await expect(page.getByRole('dialog', { name: '离开工作流配置' })).toBeVisible();
  await page.getByRole('button', { name: '继续配置', exact: true }).click();
  await expect(dialog.getByLabel('API 格式工作流 JSON', { exact: true })).toHaveValue(content);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  expect(remote.mock.submissions).toHaveLength(0);
});
