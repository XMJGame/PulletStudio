import { expect, test, request, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { startComfyMock, fixtureWorkflow, fixtureCreativeFields } from '../fixtures/comfy-mock.mjs';
import { createMediaFixtures } from '../fixtures/media-fixtures.mjs';
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
  const fixtures = await createMediaFixtures(
    resolve('test-results/workflow-fixtures'),
    process.env.FFMPEG_PATH ||
      (process.platform === 'win32' ? resolve('data/tools/ffmpeg/bin/ffmpeg.exe') : 'ffmpeg'),
  );
  remote = await startComfyMock({ 'image.png': fixtures['image.png'].bytes });
});
test.afterAll(async () => {
  await owner?.dispose();
  await remote?.close();
});
test.beforeEach(() => {
  remote.mock.submissions.length = 0;
  remote.mock.mode = 'normal';
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
test('empty project and canvas generate pasted prompts, save candidates and reopen without a shot', async ({
  page,
}) => {
  const value = await project('Free canvas creation');
  const connection = await api('POST', `/projects/${value.id}/generation-connections`, {
    name: 'Free fixture',
    baseUrl: remote.baseUrl,
    trustedPrivate: true,
  });
  const workflow = await api('POST', `/projects/${value.id}/generation-workflows`, {
    ...fixtureWorkflow(connection.id),
    name: 'Free draft T2I',
    reviewRequired: true,
  });
  await open(page, value);
  await page
    .getByRole('dialog', { name: '工作流中心', exact: true })
    .getByRole('button', { name: '关闭工作流中心', exact: true })
    .click();
  await expect(page.getByRole('region', { name: '项目创作' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI 分镜', exact: true })).not.toBeVisible();
  await page.screenshot({ path: 'test-results/light-project-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '创作画布', exact: true }).click();
  await page.getByRole('textbox', { name: '画布名称', exact: true }).fill('Prompt study');
  await page.getByRole('button', { name: '创建画布', exact: true }).click();
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  await page.getByLabel('画布文字内容', { exact: true }).fill('A train entering a sunlit station');
  await page.getByRole('button', { name: '自由生成', exact: true }).click();
  const generation = page.getByRole('dialog', { name: '自由生成', exact: true });
  await expect(generation.getByLabel('正向提示词', { exact: true })).toHaveValue(
    'A train entering a sunlit station',
  );
  await expect(generation.getByLabel('已保存提示词', { exact: true })).toHaveCount(0);
  await generation.getByLabel('生成工作流', { exact: true }).selectOption(workflow.id);
  remote.mock.mode = 'hold';
  await generation.getByRole('button', { name: '加入生成队列', exact: true }).click();
  await expect(generation.getByRole('status')).toContainText('生成任务已加入队列');
  await generation.getByRole('button', { name: '关闭', exact: true }).click();
  remote.mock.mode = 'normal';
  await page.getByRole('button', { name: '自由生成', exact: true }).click();
  await expect(generation.getByText('候选已生成', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(generation.getByAltText('生成候选')).toBeVisible();
  expect((await api('GET', `/projects/${value.id}/media-assets`)).items).toHaveLength(0);
  await generation.getByRole('button', { name: '存入素材库', exact: true }).click();
  await expect(generation.getByText('已存入素材库', { exact: true })).toBeVisible();
  await generation.getByRole('button', { name: '添加到画布', exact: true }).click();
  await expect(generation.getByRole('status')).toContainText('已添加到画布');
  await generation.getByRole('button', { name: '复用提示词', exact: true }).click();
  await expect(generation.getByLabel('正向提示词', { exact: true })).toHaveValue(
    'A train entering a sunlit station',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => generation.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/light-generation-mobile.png' });
  await generation.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '保存画布', exact: true }).click();
  await expect(page.locator('.creative-save-state')).toContainText('已保存');
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.getByRole('button', { name: '自由生成', exact: true }).click();
  await expect(generation.getByText('已存入素材库', { exact: true })).toBeVisible();
  const history = await api('GET', `/projects/${value.id}/generation-jobs`);
  expect(history.items).toHaveLength(1);
  expect(history.items[0].shotId).toBeNull();
  expect(history.items[0].takeId).toBeNull();
  await generation.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await page.getByRole('button', { name: '工作流中心', exact: true }).click();
  await page.getByRole('button', { name: '试跑与发布', exact: true }).click();
  await page.getByRole('button', { name: '粘贴提示词试跑', exact: true }).click();
  const trial = page.getByRole('dialog', { name: '工作流试跑', exact: true });
  await trial.getByLabel('正向提示词', { exact: true }).fill('A quiet testing scene');
  await trial.getByRole('button', { name: '加入试跑队列', exact: true }).click();
  await expect(trial.getByText('试跑证据已归档', { exact: true })).toBeVisible({ timeout: 15000 });
});

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

test('saved schemas revise immutably, preserve conflicting input, load latest and restore/ archive explicitly', async ({
  page,
}) => {
  const value = await project('Revision management');
  const connection = await api('POST', `/projects/${value.id}/generation-connections`, {
    name: 'Revision fixture',
    baseUrl: remote.baseUrl,
    trustedPrivate: true,
  });
  const definition = fixtureCreativeFields(connection.id),
    first = await api('POST', `/projects/${value.id}/generation-workflows`, definition);
  await open(page, value);
  const dialog = page.getByRole('dialog', { name: '工作流中心', exact: true });
  await dialog.getByRole('button', { name: '查看 / 修订', exact: true }).click();
  await expect(dialog.getByLabel('工作流名称', { exact: true })).toHaveValue(definition.name);
  await dialog.getByText(/^公开创作参数/).click();
  await dialog.getByLabel('参数1名称', { exact: true }).fill('镜头补充说明');
  await dialog.getByLabel('参数2最大值', { exact: true }).fill('10');
  await dialog.getByLabel('工作流修订说明').fill('Expose precise creative controls');
  await dialog.getByRole('button', { name: '验证绑定并保存', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('修订 v2');
  await expect(dialog.getByRole('region', { name: '已保存的工作流' })).toContainText('v2');
  expect((await api('GET', `/generation-workflows/${first.id}/definition`)).definition.fields[0].label).toBe(
    '补充描述',
  );
  await dialog.getByRole('button', { name: '检查已保存依赖' }).click();
  await expect(dialog.getByRole('region', { name: '工作流依赖报告' })).toContainText('声明匹配');
  const current = await api('GET', `/workflow-catalogs/${first.familyId}/definition`);
  await dialog.getByLabel('工作流名称', { exact: true }).fill('LOCAL REVISION DRAFT');
  await api('POST', `/workflow-catalogs/${first.familyId}/revisions`, {
    expectedVersion: current.catalog.version,
    summary: 'Concurrent writer',
    definition: { ...current.definition, name: 'Remote writer revision' },
  });
  await dialog.getByRole('button', { name: '验证绑定并保存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('草稿');
  await expect(dialog.getByLabel('工作流名称', { exact: true })).toHaveValue('LOCAL REVISION DRAFT');
  await dialog.getByRole('button', { name: '载入最新配置' }).click();
  await expect(page.getByRole('dialog', { name: '切换工作流配置' })).toBeVisible();
  await page.getByRole('button', { name: '保留草稿', exact: true }).click();
  await expect(dialog.getByLabel('工作流名称', { exact: true })).toHaveValue('LOCAL REVISION DRAFT');
  await dialog.getByRole('button', { name: '载入最新配置' }).click();
  await page.getByRole('button', { name: '丢弃草稿并切换' }).click();
  await expect(dialog.getByLabel('工作流名称', { exact: true })).toHaveValue('Remote writer revision');
  await dialog.getByRole('button', { name: '修订历史', exact: true }).click();
  await page.getByRole('button', { name: '恢复 v1 为新修订', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复为新修订', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('已从历史追加');
  const restored = await api('GET', `/workflow-catalogs/${first.familyId}/definition`);
  expect(restored.catalog.revision).toBe(4);
  expect(restored.definition.fields[0].label).toBe('补充描述');
  await dialog.getByRole('button', { name: '归档目录', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '已保存的工作流' })).toContainText('已归档');
  expect((await api('GET', `/projects/${value.id}/generation-config`)).workflows[0].enabled).toBeFalsy();
  await dialog.getByRole('button', { name: '取消归档', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('已取消归档');
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByText(/^公开创作参数/).click();
  await page.screenshot({ path: 'test-results/workflow-fields-mobile.png' });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
});

test('creator form renders declared scalar controls and freezes overrides into a normal generation job', async ({
  page,
}) => {
  const value = await project('Creative parameter job');
  const connection = await api('POST', `/projects/${value.id}/generation-connections`, {
    name: 'Scalar fixture',
    baseUrl: remote.baseUrl,
    trustedPrivate: true,
  });
  const definition = fixtureCreativeFields(connection.id),
    workflow = await api('POST', `/projects/${value.id}/generation-workflows`, definition);
  const basic = await api('POST', `/projects/${value.id}/shots`, {
    description: 'A train enters a covered platform.',
  });
  const editor = await api('GET', `/shots/${basic.id}/card/editor`);
  const shot = (
    await api('PATCH', `/shots/${basic.id}/card`, { expectedVersion: basic.version, body: editor.body })
  ).shot;
  await api('POST', `/shots/${shot.id}/prompts/compile`, {
    mode: 'commit',
    expectedShotVersion: shot.version,
    expectedProjectVersion: value.version,
    profileRevisionId: null,
  });
  await open(page, value);
  await page.getByRole('button', { name: '关闭工作流中心' }).click();
  await page.getByText('兼容制作工具', { exact: true }).click();
  await page.getByRole('button', { name: '制作结构', exact: true }).click();
  await page.locator('.structure-shot-list button').filter({ hasText: shot.code }).click();
  await page.getByRole('button', { name: '媒体生成', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '镜头媒体生成', exact: true });
  await dialog.getByLabel('生成工作流', { exact: true }).selectOption(workflow.id);
  await dialog.getByLabel('已保存提示词', { exact: true }).selectOption({ index: 1 });
  await dialog.getByLabel('创作参数：补充描述', { exact: true }).fill('Soft rain across the platform');
  await dialog.getByLabel('创作参数：迭代次数', { exact: true }).fill('8');
  await dialog.getByLabel('创作参数：细节增强', { exact: true }).uncheck();
  await dialog.getByLabel('创作参数：质量档位', { exact: true }).selectOption('high');
  // A refreshed catalog must not silently replace a selected fixed revision or its form schema.
  const latest = await api('GET', `/workflow-catalogs/${workflow.familyId}/definition`);
  const updated = structuredClone(latest.definition);
  updated.name = 'Newer controls';
  updated.fields[0].label = '新版本说明';
  await api('POST', `/workflow-catalogs/${workflow.familyId}/revisions`, {
    expectedVersion: latest.catalog.version,
    summary: 'New head while creator is editing',
    definition: updated,
  });
  await dialog.getByText('配置 ComfyUI 连接与工作流', { exact: true }).click();
  await dialog.getByLabel('连接名称', { exact: true }).fill('Refresh configuration fixture');
  await dialog.getByLabel('ComfyUI 基础地址', { exact: true }).fill(remote.baseUrl);
  await dialog.getByLabel('批准自部署 HTTP 或私有网络地址').check();
  await dialog.getByRole('button', { name: '添加连接', exact: true }).click();
  await expect(dialog.getByLabel('创作参数：补充描述', { exact: true })).toHaveValue(
    'Soft rain across the platform',
  );
  await expect(dialog.getByLabel('创作参数：新版本说明', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('确认发送所选提示词到该工作流并消耗生成资源').check();
  await dialog.getByRole('button', { name: '加入生成队列', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('生成任务已加入队列');
  await expect(dialog.getByText('补充描述：Soft rain across the platform', { exact: true })).toBeVisible();
  await expect(dialog.getByText('细节增强：关闭', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/工作流 v1 · 制作卡/)).toBeVisible();
  const jobs = await api('GET', `/shots/${shot.id}/generation-jobs`);
  const job = jobs.items ? jobs.items[0] : jobs[0];
  expect(job.workflowRevision).toBe(1);
  expect(job.fieldValues).toEqual(
    Object.fromEntries(
      definition.fields.map((field: any, index: number) => [
        field.id,
        ['Soft rain across the platform', 8, false, 'high'][index],
      ]),
    ),
  );
  await expect.poll(async () => (await api('GET', `/generation-jobs/${job.id}`)).state).toBe('completed');
  expect(remote.mock.submissions).toHaveLength(1);
});

test('manager runs a fixed draft and releases only the reviewed evidence', async ({ page }) => {
  const value = await project('Controlled workflow release');
  const connection = await api('POST', `/projects/${value.id}/generation-connections`, {
    name: 'Release fixture',
    baseUrl: remote.baseUrl,
    trustedPrivate: true,
  });
  const workflow = await api('POST', `/projects/${value.id}/generation-workflows`, {
    ...fixtureCreativeFields(connection.id),
    name: 'Workflow under review',
    reviewRequired: true,
  });
  const basic = await api('POST', `/projects/${value.id}/shots`, {
    description: 'A worker enters a studio.',
  });
  const editor = await api('GET', `/shots/${basic.id}/card/editor`);
  const shot = (
    await api('PATCH', `/shots/${basic.id}/card`, { expectedVersion: basic.version, body: editor.body })
  ).shot;
  await api('POST', `/shots/${shot.id}/prompts/compile`, {
    mode: 'commit',
    expectedShotVersion: shot.version,
    expectedProjectVersion: value.version,
    profileRevisionId: null,
  });
  await open(page, value);
  const center = page.getByRole('dialog', { name: '工作流中心', exact: true });
  await expect(center.getByText('待审核发布', { exact: true })).toBeVisible();
  await center.getByRole('button', { name: '试跑与发布', exact: true }).click();
  const review = page.getByRole('dialog', { name: '试跑与发布', exact: true });
  await review.getByText('使用旧镜头试跑（兼容）', { exact: true }).click();
  await review.getByRole('button', { name: '读取项目镜头', exact: true }).click();
  await review.getByLabel('试跑镜头', { exact: true }).selectOption(shot.id);
  await review.getByRole('button', { name: '打开试跑表单', exact: true }).click();
  const trial = page.getByRole('dialog', { name: '工作流试跑', exact: true });
  await trial.getByLabel('已保存提示词', { exact: true }).selectOption({ index: 1 });
  await trial.getByLabel('创作参数：补充描述', { exact: true }).fill('Overhead light');
  const submit = trial.getByRole('button', { name: '加入试跑队列', exact: true });
  await expect(submit).toBeDisabled();
  await trial.getByRole('button', { name: '核对提示词', exact: true }).click();
  await expect(trial.getByLabel('正向提示词', { exact: true })).toBeVisible();
  await trial.getByLabel('确认将所选输入发送到 ComfyUI 并消耗试跑资源', { exact: true }).check();
  await submit.click();
  await expect(trial.getByText('试跑证据已归档', { exact: true })).toBeVisible({ timeout: 15000 });
  await trial.getByRole('button', { name: '关闭', exact: true }).click();
  await review.getByText('预览试跑结果', { exact: true }).click();
  await expect(review.getByAltText('试跑结果')).toBeVisible();
  await expect
    .poll(() =>
      review.getByAltText('试跑结果').evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(96);
  await expect(review.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
  await review.getByRole('radio', { name: '选为发布依据' }).check();
  await review.getByLabel('审核意见', { exact: true }).fill('预览构图已核对');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => review.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/workflow-release-mobile.png' });
  await review.getByRole('button', { name: '确认发布', exact: true }).click();
  await expect(review.getByRole('status')).toContainText('工作流已发布给项目团队');
  expect(
    (await api('GET', `/projects/${value.id}/generation-config`)).productionWorkflows.map(
      (item: { id: string }) => item.id,
    ),
  ).toEqual([workflow.id]);
  await review.getByLabel('审核意见', { exact: true }).fill('暂时停用此版');
  await review.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(review.getByRole('status')).toContainText('工作流发布已撤回');
  const history = review.getByRole('region', { name: '发布历史' });
  const published = history.locator('article').filter({ hasText: '发布 v1' });
  await published.getByRole('button', { name: '查看发布依据', exact: true }).click();
  await published.getByText('预览试跑结果', { exact: true }).click();
  await expect(published.getByText('补充描述 · Overhead light', { exact: true })).toBeVisible();
  expect((await api('GET', `/projects/${value.id}/generation-config`)).productionWorkflows).toEqual([]);
  expect((await api('GET', `/shots/${shot.id}/takes`)).items).toEqual([]);
});

test('workspace pool enrolls two instances and displays different workflow checks', async ({ page }) => {
  const alternate = await startComfyMock({});
  try {
    const value = await project('Instance pool evidence');
    const first = await api('POST', `/projects/${value.id}/generation-connections`, {
      name: 'Local A',
      baseUrl: remote.baseUrl,
      trustedPrivate: true,
    });
    const second = await api('POST', `/projects/${value.id}/generation-connections`, {
      name: 'Local B',
      baseUrl: alternate.baseUrl,
      trustedPrivate: true,
    });
    const workflow = await api('POST', `/projects/${value.id}/generation-workflows`, {
      ...fixtureWorkflow(first.id),
      name: 'Pool comparison workflow',
    });
    const draft = await api('POST', `/workflow-catalogs/${workflow.familyId}/revisions`, {
      expectedVersion: 1,
      summary: 'Keep production v1 while editing v2',
      definition: { ...fixtureWorkflow(first.id), name: 'Pool comparison draft', reviewRequired: true },
    });
    alternate.mock.objectInfoOverrides = { ImageOutput: null };
    alternate.mock.queue = { queue_running: [['private remote work']], queue_pending: [] };
    await open(page, value);
    const center = page.getByRole('dialog', { name: '工作流中心', exact: true });
    await center.getByRole('button', { name: '管理实例池', exact: true }).click();
    const pool = page.getByRole('dialog', { name: 'ComfyUI 实例池', exact: true });
    for (const connection of [first, second]) {
      await pool.getByLabel('实例连接', { exact: true }).selectOption(connection.id);
      await pool.getByLabel('加入工作区实例池').check();
      await pool.getByRole('button', { name: '保存实例池设置', exact: true }).click();
      await expect(pool.getByRole('status')).toContainText('实例池设置已保存');
    }
    await expect(pool.getByRole('heading', { name: '工作区实例 · 2/12', exact: true })).toBeVisible();
    await expect(pool.getByLabel('检查工作流修订').locator(`option[value="${draft.id}"]`)).toHaveCount(1);
    await pool.getByLabel('检查工作流修订', { exact: true }).selectOption(workflow.id);
    const a = pool.locator('article').filter({ hasText: 'Local A' });
    const b = pool.locator('article').filter({ hasText: 'Local B' });
    const submissions = remote.mock.submissions.length;
    await a.getByRole('button', { name: '检查 Local A', exact: true }).click();
    await expect(a).toContainText('声明匹配 · 负载低于阈值');
    await b.getByRole('button', { name: '检查 Local B', exact: true }).click();
    await expect(b).toContainText('依赖不匹配 · 已达到负载阈值');
    await b.getByText('查看依赖明细', { exact: true }).click();
    await expect(b.getByText('节点类型未安装', { exact: true })).toBeVisible();
    await expect(pool).not.toContainText('private remote work');
    expect(remote.mock.submissions).toHaveLength(submissions);
    expect(alternate.mock.submissions).toHaveLength(0);
    await pool.getByLabel('实例连接', { exact: true }).selectOption(first.id);
    await pool.getByLabel('运行任务阈值').fill('2');
    await pool.getByRole('button', { name: '保存实例池设置', exact: true }).click();
    await expect(a).toContainText('检查已过期');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => pool.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await page.screenshot({ path: 'test-results/workflow-instance-pool-mobile.png' });
  } finally {
    await alternate.close();
  }
});

test('generation defaults to automatic routing and records the manually selected instance', async ({
  page,
}) => {
  const image = await readFile(resolve('test-results/workflow-fixtures/image.png'));
  const first = await startComfyMock({ 'image.png': image });
  const second = await startComfyMock({ 'image.png': image });
  try {
    const value = await project('Pool generation controls');
    const register = async (name: string, baseUrl: string) => {
      const connection = await api('POST', `/projects/${value.id}/generation-connections`, {
        name,
        baseUrl,
        trustedPrivate: true,
      });
      await api('PATCH', `/generation-connections/${connection.id}/pool`, {
        expectedPoolVersion: 1,
        poolEnabled: true,
        maxRunning: 1,
        maxPending: 2,
      });
      return connection.id;
    };
    const aId = await register('Render A', first.baseUrl);
    const bId = await register('Render B', second.baseUrl);
    const workflow = await api('POST', `/projects/${value.id}/generation-workflows`, fixtureWorkflow(aId));
    for (const id of [aId, bId])
      await api('POST', `/generation-workflows/${workflow.id}/instance-checks/${id}`, {});
    const basic = await api('POST', `/projects/${value.id}/shots`, { description: 'A lamp lights a hall.' });
    const editor = await api('GET', `/shots/${basic.id}/card/editor`);
    const shot = (
      await api('PATCH', `/shots/${basic.id}/card`, { expectedVersion: basic.version, body: editor.body })
    ).shot;
    const prompt = await api('POST', `/shots/${shot.id}/prompts/compile`, {
      mode: 'commit',
      expectedShotVersion: shot.version,
      expectedProjectVersion: value.version,
      profileRevisionId: null,
    });
    await open(page, value);
    await page.getByRole('button', { name: '关闭工作流中心' }).click();
    await page.getByText('兼容制作工具', { exact: true }).click();
    await page.getByRole('button', { name: '制作结构', exact: true }).click();
    await page.locator('.structure-shot-list button').filter({ hasText: shot.code }).click();
    await page.getByRole('button', { name: '媒体生成', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '镜头媒体生成', exact: true });
    await dialog.getByLabel('生成工作流', { exact: true }).selectOption(workflow.id);
    const mode = dialog.getByLabel('实例调度方式', { exact: true });
    await expect(mode).toHaveValue('auto');
    await expect(dialog.getByText('2 个匹配实例当前可预留')).toBeVisible();
    await mode.selectOption('manual');
    await dialog.getByLabel('已保存提示词', { exact: true }).selectOption(prompt.id);
    await dialog.getByLabel('确认发送所选提示词到该工作流并消耗生成资源').check();
    const submit = dialog.getByRole('button', { name: '加入生成队列', exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('生成实例', { exact: true }).selectOption(bId);
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('确认发送所选提示词到该工作流并消耗生成资源').check();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/generation-instance-routing-mobile.png' });
    await submit.click();
    await expect(dialog.getByText('实例 Render B · 手动指定', { exact: true })).toBeVisible();
    await expect(dialog.getByText('已归档为镜头候选', { exact: true })).toBeVisible({ timeout: 15000 });
    expect(first.mock.submissions).toHaveLength(0);
    expect(second.mock.submissions).toHaveLength(1);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
