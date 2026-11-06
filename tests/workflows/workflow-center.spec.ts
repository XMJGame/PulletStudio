import { expect, test, request, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { startComfyMock, fixtureWorkflow, fixtureCreativeFields } from '../fixtures/comfy-mock.mjs';
import { createMediaFixtures } from '../fixtures/media-fixtures.mjs';
import { zoomBrowser } from '../fixtures/browser-zoom.mjs';
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
async function openCenter(page: Page) {
  await page.getByText('更多操作', { exact: true }).click();
  await page.getByRole('button', { name: '工作流中心', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '工作流中心', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: `打开项目 ${value.title}`, exact: true }).click();
  await openCenter(page);
}
test('formal project and library views work across themes, screen sizes and actual browser zoom', async ({
  playwright,
}, testInfo) => {
  const value = await project('海岸来信');
  const connection = await api('POST', `/projects/${value.id}/generation-connections`, {
    name: '隔离验收服务',
    baseUrl: remote.baseUrl,
    trustedPrivate: true,
  });
  const workflow = await api('POST', `/projects/${value.id}/generation-workflows`, {
    ...fixtureCreativeFields(connection.id),
    name: '画面构图研究',
  });
  await api('POST', `/projects/${value.id}/prompt-library`, {
    title: '清晨海岸 · 缓慢推进',
    positivePrompt: '晨光穿过薄雾，镜头缓慢沿海岸推进，保持柔和自然的光线与连贯运动。',
    negativePrompt: '水印、文字、画面闪烁',
    tags: ['海岸', '晨光'],
    source: '独立测试创作笔记',
    workflowId: workflow.id,
  });
  const { context, setZoom } = await zoomBrowser(playwright.chromium, testInfo.outputPath('library-zoom'));
  try {
    const page = await context.newPage();
    await open(page, value);
    await page.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
    await page.getByRole('textbox', { name: '画布名称', exact: true }).fill('光线与构图');
    await page.getByRole('button', { name: '创建画布', exact: true }).click();
    await expect(page.getByLabel('当前画布名称')).toHaveValue('光线与构图');
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: '深色画布', exact: true }).click();
      for (const viewport of [
        { width: 1920, height: 1080 },
        { width: 1440, height: 900 },
        { width: 1366, height: 768 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await inspect(theme, String(viewport.width));
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const factor of [1.25, 1.5]) {
        expect(await setZoom(page.url(), factor)).toBe(factor);
        expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(Math.round(1440 / factor));
        await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(factor);
        await inspect(theme, `zoom-${Math.round(factor * 100)}`);
      }
      expect(await setZoom(page.url(), 1)).toBe(1);
    }
    async function inspect(theme: string, size: string) {
      const center = page.getByRole('dialog', { name: '工作流中心', exact: true });
      const library = page.getByRole('dialog', { name: '项目提示词库', exact: true });
      await page.getByRole('button', { name: '返回工作台', exact: true }).click();
      const search = page.getByRole('searchbox', { name: '搜索项目' });
      await search.fill('海岸来信');
      const projectCard = page.getByRole('button', { name: '打开项目 海岸来信', exact: true });
      await expect(projectCard).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await search.clear();
      await page.locator('.v2-project-main').evaluate((element) => {
        element.scrollIntoView({ block: 'start' });
      });
      await page.screenshot({ path: `test-results/review-project-${theme}-${size}.png` });
      await projectCard.click();
      await page.getByRole('button', { name: '提示词库', exact: true }).click();
      await expect(library).toHaveAttribute('data-theme', theme);
      await library.getByLabel('搜索提示词', { exact: true }).fill('清晨海岸');
      await library.getByRole('button', { name: /清晨海岸 · 缓慢推进 · v1/ }).click();
      await expect(library.getByLabel('库正向提示词')).toHaveValue(
        '晨光穿过薄雾，镜头缓慢沿海岸推进，保持柔和自然的光线与连贯运动。',
      );
      await library.getByLabel('库正向提示词').fill('只在本地检查布局的提示词草稿');
      await library.getByRole('button', { name: '保存为新版本', exact: true }).scrollIntoViewIfNeeded();
      await expect(library.getByRole('button', { name: '保存为新版本', exact: true })).toBeInViewport();
      await library
        .getByLabel('库正向提示词')
        .fill('晨光穿过薄雾，镜头缓慢沿海岸推进，保持柔和自然的光线与连贯运动。');
      expect(await library.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/review-prompts-${theme}-${size}.png` });
      await library.getByRole('button', { name: '关闭对话框', exact: true }).click();
      await expect(page.getByRole('button', { name: '提示词库', exact: true })).toBeFocused();
      await openCenter(page);
      await expect(center).toHaveAttribute('data-theme', theme);
      await center.getByRole('button', { name: '查看 / 修订', exact: true }).click();
      await expect(center.getByLabel('工作流名称', { exact: true })).toHaveValue('画面构图研究');
      await center.getByRole('button', { name: '预览节点图', exact: true }).click();
      await center.getByLabel('选择工作流节点', { exact: true }).selectOption('1');
      await center.getByLabel('节点常量输入', { exact: true }).selectOption('text');
      await expect(center.getByRole('button', { name: '设为正向文本', exact: true })).toBeEnabled();
      await center.getByRole('button', { name: '设为正向文本', exact: true }).scrollIntoViewIfNeeded();
      await expect(center.getByRole('button', { name: '设为正向文本', exact: true })).toBeInViewport();
      await center.getByRole('button', { name: '验证绑定并保存', exact: true }).scrollIntoViewIfNeeded();
      await expect(center.getByRole('button', { name: '验证绑定并保存', exact: true })).toBeInViewport();
      expect(await center.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await center.locator('.workflow-technical-surface').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/review-workflows-${theme}-${size}.png` });
      await center.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
    }
    expect(remote.mock.submissions).toHaveLength(0);
    expect((await api('GET', `/workflow-catalogs/${workflow.familyId}/definition`)).catalog.revision).toBe(1);
  } finally {
    await context.close();
  }
});

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
  await expect(page.getByRole('main', { name: '创作画布', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI 分镜', exact: true })).not.toBeVisible();
  await page.screenshot({ path: 'test-results/light-project-desktop.png', fullPage: true });
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
  await page.getByRole('button', { name: `打开项目 ${value.title}`, exact: true }).click();
  await openCenter(page);
  await page.getByRole('button', { name: '试跑与发布', exact: true }).click();
  await page.getByRole('button', { name: '粘贴提示词试跑', exact: true }).click();
  const trial = page.getByRole('dialog', { name: '工作流试跑', exact: true });
  await trial.getByLabel('正向提示词', { exact: true }).fill('A quiet testing scene');
  await trial.getByRole('button', { name: '加入试跑队列', exact: true }).click();
  await expect(trial.getByText('试跑证据已归档', { exact: true })).toBeVisible({ timeout: 15000 });
});

test('prompt library revises with conflict recovery, clipboard and revoked read access', async ({
  page,
  browser,
}) => {
  const value = await project('Reusable prompts');
  await open(page, value);
  await page.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
  await page.getByRole('button', { name: '打开提示词库', exact: true }).click();
  const library = page.getByRole('dialog', { name: '项目提示词库', exact: true });
  await library.getByLabel('提示词标题', { exact: true }).fill('Station lighting');
  await library.getByLabel('库正向提示词').fill('A station in evening light');
  await library.getByLabel('库负向提示词').fill('No lettering');
  await library.getByText('标签、来源和推荐工作流（可选）', { exact: true }).click();
  await library.getByLabel('提示词标签', { exact: true }).fill('scene, evening');
  await library.getByLabel('库来源说明').fill('External prompt notes');
  await library.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(library.getByRole('status')).toContainText('已保存为 v1');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await library.getByRole('button', { name: '复制正向提示词', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('A station in evening light');
  const {
    items: [entry],
  } = await api('GET', `/projects/${value.id}/prompt-library`);
  const original = (await api('GET', `/prompt-library/${entry.id}`)).revision;
  await api('POST', `/prompt-library/${entry.id}/revisions`, {
    ...original,
    id: undefined,
    entryId: undefined,
    projectId: undefined,
    version: undefined,
    createdAt: undefined,
    expectedVersion: 1,
    positivePrompt: 'Remote newer text',
  });
  await library.getByLabel('库正向提示词').fill('My local draft survives');
  await library.getByRole('button', { name: '保存为新版本', exact: true }).click();
  await expect(library.getByRole('alert')).toContainText('新版本');
  await expect(library.getByLabel('库正向提示词')).toHaveValue('My local draft survives');
  await page.screenshot({ path: 'test-results/review-prompt-conflict.png' });
  page.once('dialog', (dialog) => dialog.accept());
  await library.getByRole('button', { name: '载入最新提示词版本' }).click();
  await expect(library.getByLabel('库正向提示词')).toHaveValue('Remote newer text');
  await library.getByRole('button', { name: '修订历史', exact: true }).click();
  await library.getByRole('button', { name: '查看 v1 · Station lighting', exact: true }).click();
  await expect(library.getByLabel('库正向提示词')).toHaveValue('A station in evening light');
  await expect(library.getByLabel('库正向提示词')).toBeDisabled();
  await page.screenshot({ path: 'test-results/prompt-library-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/prompt-library-mobile.png' });
  expect(await library.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await library.getByRole('button', { name: '提示词列表', exact: true }).click();
  await library.getByLabel('搜索提示词').fill('Remote newer');
  await library.getByLabel('筛选标签').fill('scene');
  await expect(library.getByRole('button', { name: /Station lighting · v2/ })).toHaveCount(1);
  await library.getByRole('button', { name: '提示词内容', exact: true }).click();
  await expect(library.getByLabel('库正向提示词')).toBeVisible();
  await expect(library.getByLabel('库正向提示词')).toHaveValue('A station in evening light');

  const reader = await request.newContext({ baseURL: 'http://127.0.0.1:5192' });
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5192' });
  try {
    const invite = await api('POST', `/workspaces/${setup.workspace.id}/invitations`, {
      email: 'prompt-reader@workflow.test',
    });
    const response = await reader.post('/api/v1/invitations/accept', {
      data: { token: invite.token, name: 'Prompt reader', password: 'Studio8!' },
      headers: { 'X-Studio-Request': '1' },
    });
    expect(response.ok()).toBeTruthy();
    const joined = await response.json();
    await api('POST', `/projects/${value.id}/members`, { userId: joined.user.id, role: 'VIEWER' });
    const viewer = await context.newPage();
    await open(viewer, value, reader, joined.user.id);
    await viewer.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
    await viewer.getByRole('button', { name: '打开提示词库', exact: true }).click();
    const readonly = viewer.getByRole('dialog', { name: '项目提示词库', exact: true });
    await readonly.getByRole('button', { name: /Station lighting · v2/ }).click();
    await expect(readonly.getByLabel('库正向提示词')).toBeDisabled();
    await expect(readonly.getByRole('button', { name: '复制正向提示词', exact: true })).toBeEnabled();
    await api('DELETE', `/projects/${value.id}/members/${joined.user.id}`, { expectedRole: 'VIEWER' });
    await readonly.getByRole('button', { name: '刷新列表', exact: true }).click();
    await expect(readonly.getByRole('alert')).toBeVisible();
    await expect(readonly.getByLabel('库正向提示词')).toHaveCount(0);
    await expect(readonly.getByRole('button', { name: '复制正向提示词', exact: true })).toHaveCount(0);
  } finally {
    await reader.dispose();
    await context.close();
  }
});

test('full prompt versions travel through generation and separate canvases without truncation', async ({
  page,
}) => {
  const value = await project('Prompt creation loop');
  const connection = await api('POST', `/projects/${value.id}/generation-connections`, {
    name: 'Prompt fixture',
    baseUrl: remote.baseUrl,
    trustedPrivate: true,
  });
  const workflow = await api(
    'POST',
    `/projects/${value.id}/generation-workflows`,
    fixtureWorkflow(connection.id),
  );
  const text = 'A softly lit station. '.repeat(250).trim();
  await open(page, value);
  await page.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  const generation = page.getByRole('dialog', { name: '自由生成', exact: true });
  await generation.getByLabel('生成工作流', { exact: true }).selectOption(workflow.id);
  await generation.getByLabel('正向提示词', { exact: true }).fill(text);
  await generation.getByText('负向提示词与来源（可选）', { exact: true }).click();
  await generation.getByLabel('负向提示词', { exact: true }).fill('No lettering');
  await generation.getByRole('button', { name: '保存到提示词库', exact: true }).click();
  const library = page.getByRole('dialog', { name: '项目提示词库', exact: true });
  await expect(library.getByLabel('库正向提示词')).toHaveValue(text);
  await library.getByLabel('提示词标题', { exact: true }).fill('Full station prompt');
  await library.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(library.getByRole('status')).toContainText('已保存为 v1');
  await library.getByRole('button', { name: '应用此版本', exact: true }).click();
  await generation.getByRole('button', { name: '加入生成队列', exact: true }).click();
  await expect(generation.getByText('候选已生成', { exact: true })).toBeVisible({ timeout: 15000 });
  const {
    items: [job],
  } = await api('GET', `/projects/${value.id}/generation-jobs`);
  expect(job.promptLibrary.version).toBe(1);
  expect(job.prompt.positivePrompt).toBe(text);
  expect(remote.mock.submissions[0].prompt['1'].inputs.text).toBe(text);
  const revision = (await api('GET', `/prompt-library-revisions/${job.promptLibrary.revisionId}`)).revision;
  const { id, entryId, projectId, version, createdAt, ...body } = revision;
  await api('POST', `/prompt-library/${entryId}/revisions`, {
    ...body,
    positivePrompt: 'Latest station text',
    expectedVersion: 1,
  });
  expect((await api('GET', `/generation-jobs/${job.id}`)).prompt.positivePrompt).toBe(text);
  await generation.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByLabel('画布名称', { exact: true }).fill('Original prompt study');
  await page.getByRole('button', { name: '创建画布', exact: true }).click();
  await page.getByRole('button', { name: '提示词库', exact: true }).click();
  await library.getByRole('button', { name: /Full station prompt · v2/ }).click();
  await library.getByRole('button', { name: '修订历史', exact: true }).click();
  await library.getByRole('button', { name: '查看 v1 · Full station prompt', exact: true }).click();
  await library.getByRole('button', { name: '应用此版本', exact: true }).click();
  await expect(page.getByLabel('画布文字内容', { exact: true })).toHaveValue(text);
  await page.getByRole('button', { name: '保存画布', exact: true }).click();
  const {
    items: [board],
  } = await api('GET', `/projects/${value.id}/boards`);
  const saved = await api('GET', `/boards/${board.id}`);
  expect(saved.layout.nodes[0].data).toEqual({
    text,
    prompt: { negativePrompt: 'No lettering', source: '', promptLibraryRevisionId: id },
  });
  await page.getByRole('button', { name: '自由生成', exact: true }).click();
  await expect(generation.getByLabel('正向提示词', { exact: true })).toHaveValue(text);
  await generation.getByText('负向提示词与来源（可选）', { exact: true }).click();
  await expect(generation.getByLabel('负向提示词', { exact: true })).toHaveValue('No lettering');
  await generation.getByLabel('正向提示词', { exact: true }).fill('My independent variation');
  await expect(
    generation.getByText('已引用提示词库的固定版本；修改文字后将作为自定义提示词。', { exact: true }),
  ).toHaveCount(0);
  await generation.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '切换 / 新建画布', exact: true }).click();
  await page.getByLabel('画布名称', { exact: true }).fill('Latest prompt study');
  await page.getByRole('button', { name: '创建画布', exact: true }).click();
  await page.getByRole('button', { name: '提示词库', exact: true }).click();
  await library.getByRole('button', { name: /Full station prompt · v2/ }).click();
  await library.getByRole('button', { name: '应用此版本', exact: true }).click();
  await expect(page.getByLabel('画布文字内容', { exact: true })).toHaveValue('Latest station text');
  await page.getByRole('button', { name: '保存画布', exact: true }).click();
  expect((await api('GET', `/boards/${board.id}`)).layout.nodes[0].data.text).toBe(text);
});

test('project workflow center imports, visualizes and maps existing API fields without submitting generation', async ({
  page,
}) => {
  const value = await project('Workflow setup');
  await open(page, value);
  const dialog = page.getByRole('dialog', { name: '工作流中心', exact: true });
  await dialog.getByText('ComfyUI 连接', { exact: true }).click();
  await dialog.getByLabel('连接名称', { exact: true }).fill('Local validation fixture');
  await dialog.getByLabel('ComfyUI 基础地址', { exact: true }).fill(remote.baseUrl);
  await dialog.getByLabel('批准自部署 HTTP 或私有网络地址').check();
  await dialog.getByRole('button', { name: '添加连接', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('已添加生成连接');
  await dialog.getByText('ComfyUI 连接', { exact: true }).click();
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
  await page.screenshot({ path: 'test-results/review-workflow-invalid.png' });
  await dialog.getByLabel('选择工作流节点', { exact: true }).selectOption('3');
  await dialog.getByRole('button', { name: '设为输出节点' }).click();
  await dialog.getByRole('button', { name: '验证绑定并保存', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('工作流的绑定节点已验证并保存');
  await expect(dialog.getByRole('region', { name: '已保存的工作流' })).toContainText(
    'Mapped studio workflow',
  );
  expect(remote.mock.submissions).toHaveLength(0);
  expect(remote.mock.requests.some((path) => path.startsWith('/object_info/'))).toBeTruthy();
  await dialog.getByRole('button', { name: '预览节点图' }).click();
  await dialog.getByLabel('选择工作流节点').selectOption('1');
  await dialog.locator('.workflow-technical-surface').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/workflow-center-desktop.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '深色画布', exact: true }).click();
  await openCenter(page);
  await expect(dialog).toHaveAttribute('data-theme', 'dark');
  await expect(dialog.getByRole('region', { name: '已保存的工作流' })).toContainText(
    'Mapped studio workflow',
  );
  await dialog.getByRole('button', { name: '查看 / 修订', exact: true }).click();
  await dialog.getByRole('button', { name: '预览节点图', exact: true }).click();
  await dialog.getByLabel('选择工作流节点').selectOption('3');
  await dialog.locator('.workflow-technical-surface').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/workflow-center-dark.png', animations: 'disabled' });
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
  await dialog.getByRole('button', { name: '工作流配置', exact: true }).click();
  await dialog.getByLabel('选择工作流节点').selectOption('a');
  await dialog.getByLabel('节点常量输入').selectOption('text');
  await dialog.getByRole('button', { name: '设为正向文本' }).click();
  await dialog.getByRole('button', { name: '工作流列表', exact: true }).click();
  await expect(dialog.getByRole('region', { name: '已保存的工作流' })).toBeVisible();
  await dialog.getByRole('button', { name: '工作流配置', exact: true }).click();
  await expect(dialog.getByLabel('正向文本节点', { exact: true })).toHaveValue('a');
  await expect(dialog.getByLabel('API 格式工作流 JSON', { exact: true })).toHaveValue(content);
  await dialog.locator('.workflow-technical-surface').scrollIntoViewIfNeeded();
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
  await dialog.getByText('管理此配置', { exact: true }).click();
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
  await page.screenshot({ path: 'test-results/review-workflow-conflict.png' });
  await dialog.getByRole('button', { name: '载入最新配置' }).click();
  await expect(page.getByRole('dialog', { name: '切换工作流配置' })).toBeVisible();
  await page.getByRole('button', { name: '保留草稿', exact: true }).click();
  await expect(dialog.getByLabel('工作流名称', { exact: true })).toHaveValue('LOCAL REVISION DRAFT');
  await dialog.getByRole('button', { name: '载入最新配置' }).click();
  await page.getByRole('button', { name: '丢弃草稿并切换' }).click();
  await expect(dialog.getByLabel('工作流名称', { exact: true })).toHaveValue('Remote writer revision');
  await dialog.getByText('管理此配置', { exact: true }).click();
  await dialog.getByRole('button', { name: '修订历史', exact: true }).click();
  await page.getByRole('button', { name: '恢复 v1 为新修订', exact: true }).click();
  await page.getByRole('button', { name: '确认恢复为新修订', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('已从历史追加');
  const restored = await api('GET', `/workflow-catalogs/${first.familyId}/definition`);
  expect(restored.catalog.revision).toBe(4);
  expect(restored.definition.fields[0].label).toBe('补充描述');
  await dialog.getByText('管理此配置', { exact: true }).click();
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

test('creator fields freeze selected revisions in project generation without legacy forms', async ({
  page,
}) => {
  const value = await project('Creative fields');
  const connection = await api('POST', `/projects/${value.id}/generation-connections`, {
    name: 'Fields fixture',
    baseUrl: remote.baseUrl,
    trustedPrivate: true,
  });
  const definition = fixtureCreativeFields(connection.id),
    workflow = await api('POST', `/projects/${value.id}/generation-workflows`, definition);
  await open(page, value);
  await page.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '自由生成', exact: true });
  await dialog.getByLabel('生成工作流', { exact: true }).selectOption(workflow.id);
  await dialog.getByLabel('正向提示词', { exact: true }).fill('A station in soft light');
  await dialog.getByLabel('创作参数：补充描述', { exact: true }).fill('Soft rain across the platform');
  await dialog.getByLabel('创作参数：迭代次数', { exact: true }).fill('8');
  await dialog.getByLabel('创作参数：细节增强', { exact: true }).uncheck();
  await dialog.getByLabel('创作参数：质量档位', { exact: true }).selectOption('high');
  const latest = await api('GET', `/workflow-catalogs/${workflow.familyId}/definition`),
    updated = structuredClone(latest.definition);
  updated.name = 'Newer controls';
  updated.fields[0].label = '新版本说明';
  await api('POST', `/workflow-catalogs/${workflow.familyId}/revisions`, {
    expectedVersion: latest.catalog.version,
    summary: 'Changed while creator edits',
    definition: updated,
  });
  await expect(dialog.getByLabel('创作参数：补充描述', { exact: true })).toHaveValue(
    'Soft rain across the platform',
  );
  await expect(dialog.getByLabel('创作参数：新版本说明', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '加入生成队列', exact: true }).click();
  await expect(dialog.getByText('候选已生成', { exact: true })).toBeVisible({ timeout: 15000 });
  const {
    items: [job],
  } = await api('GET', `/projects/${value.id}/generation-jobs`);
  expect(job.workflowRevision).toBe(1);
  expect(job.shotId).toBeNull();
  expect(job.takeId).toBeNull();
  expect(job.fieldValues).toEqual(
    Object.fromEntries(
      definition.fields.map((field: any, index: number) => [
        field.id,
        ['Soft rain across the platform', 8, false, 'high'][index],
      ]),
    ),
  );
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
  await open(page, value);
  const center = page.getByRole('dialog', { name: '工作流中心', exact: true });
  await expect(center.getByText('待审核发布', { exact: true })).toBeVisible();
  await center.getByRole('button', { name: '试跑与发布', exact: true }).click();
  const review = page.getByRole('dialog', { name: '试跑与发布', exact: true });
  await review.getByRole('button', { name: '粘贴提示词试跑', exact: true }).click();
  const trial = page.getByRole('dialog', { name: '工作流试跑', exact: true });
  await trial.getByLabel('正向提示词', { exact: true }).fill('A studio under overhead light');
  await trial.getByLabel('创作参数：补充描述', { exact: true }).fill('Overhead light');
  const submit = trial.getByRole('button', { name: '加入试跑队列', exact: true });
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
  expect((await api('GET', `/generation-workflows/${workflow.id}/test-jobs`))[0].takeId).toBeNull();
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

test('project generation defaults to automatic routing and records the manual instance', async ({ page }) => {
  const image = await readFile(resolve('test-results/workflow-fixtures/image.png'));
  const first = await startComfyMock({ 'image.png': image }),
    second = await startComfyMock({ 'image.png': image });
  try {
    const value = await project('Project routing');
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
    const aId = await register('Render A', first.baseUrl),
      bId = await register('Render B', second.baseUrl);
    const workflow = await api('POST', `/projects/${value.id}/generation-workflows`, fixtureWorkflow(aId));
    for (const id of [aId, bId])
      await api('POST', `/generation-workflows/${workflow.id}/instance-checks/${id}`, {});
    await open(page, value);
    await page.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
    await page.getByRole('button', { name: '开始生成', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '自由生成', exact: true });
    await dialog.getByLabel('生成工作流', { exact: true }).selectOption(workflow.id);
    const mode = dialog.getByLabel('实例调度方式', { exact: true });
    await expect(mode).toHaveValue('auto');
    await expect(dialog.getByText('2 个匹配实例当前可预留')).toBeVisible();
    await mode.selectOption('manual');
    await dialog.getByLabel('正向提示词', { exact: true }).fill('A lamp lights a hall');
    const submit = dialog.getByRole('button', { name: '加入生成队列', exact: true });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('生成实例', { exact: true }).selectOption(bId);
    await expect(submit).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/generation-instance-routing-mobile.png' });
    await submit.click();
    await expect(dialog.getByText('实例 Render B · 手动指定', { exact: true })).toBeVisible();
    await expect(dialog.getByText('候选已生成', { exact: true })).toBeVisible({ timeout: 15000 });
    expect(first.mock.submissions).toHaveLength(0);
    expect(second.mock.submissions).toHaveLength(1);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
