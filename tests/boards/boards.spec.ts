import { test, expect, request, APIRequestContext, Page, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createMediaFixtures } from '../fixtures/media-fixtures.mjs';
import { startComfyMock, fixtureI2V, fixtureWorkflow } from '../fixtures/comfy-mock.mjs';
import { zoomBrowser } from '../fixtures/browser-zoom.mjs';
let owner: APIRequestContext, setup: any, fixtures: any;
async function expectReadable(element: Locator) {
  const ratio = await element.evaluate((element) => {
    function luminance(color: string) {
      const values = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((n) => {
          const value = n / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    }
    const style = getComputedStyle(element);
    const foreground = luminance(style.color),
      background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(ratio, 'normal text contrast including hover and warning surfaces').toBeGreaterThanOrEqual(4.5);
}
async function call(method: string, path: string, data?: unknown, actor = owner) {
  const me = await actor.get('/api/v1/auth/me');
  const session = await me.json();
  const result = await actor.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: {
      'X-Studio-Request': '1',
      'X-CSRF-Token': session.csrfToken ?? '',
      'Idempotency-Key': randomUUID(),
    },
  });
  expect(result.ok(), `${method} ${path}: ${await result.text()}`).toBeTruthy();
  return result.json();
}
test.beforeAll(async () => {
  owner = await request.newContext({ baseURL: 'http://127.0.0.1:5192' });
  const initialized = (await (await owner.get('/api/v1/setup/status')).json()).initialized;
  const result = await owner.post(`/api/v1${initialized ? '/auth/login' : '/setup/initialize'}`, {
    data: initialized
      ? { email: 'artist@board.test', password: 'Studio8!' }
      : {
          setupToken: 'playwright-formal-boards-setup-2026',
          email: 'artist@board.test',
          password: 'Studio8!',
          name: 'Creator',
          workspaceName: 'Creative production',
        },
    headers: { 'X-Studio-Request': '1' },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  setup = await result.json();
  if (initialized) setup.workspace = (await call('GET', '/workspaces'))[0];
  fixtures = await createMediaFixtures(
    resolve('test-results/board-fixtures'),
    process.env.FFMPEG_PATH ||
      (process.platform === 'win32' ? resolve('data/tools/ffmpeg/bin/ffmpeg.exe') : 'ffmpeg'),
  );
});
test.afterAll(async () => owner?.dispose());
async function project(title: string) {
  return call('POST', '/projects', { workspaceId: setup.workspace.id, title });
}
async function uploadMedia(projectId: string, name: string) {
  const intent = await call('POST', `/projects/${projectId}/media-uploads`, {
    fileName: name,
    byteLength: fixtures[name].bytes.length,
  });
  const session = await (await owner.get('/api/v1/auth/me')).json();
  const result = await owner.put(`/api/v1/media-uploads/${intent.id}/content`, {
    data: fixtures[name].bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Studio-Request': '1',
      'X-CSRF-Token': session.csrfToken,
    },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  return (await result.json()).mediaVersion;
}
async function open(page: Page, value: any, actor = owner, userId = setup.user.id) {
  await page.context().addCookies((await actor.storageState()).cookies);
  await page.addInitScript(
    ({ uid, wid, pid }) => {
      localStorage.setItem(`pullet.workspace.${uid}`, wid);
      localStorage.setItem(`pullet.project.${uid}.${wid}`, pid);
      // Poisoned G0 browser data must never appear in the formal board.
      localStorage.setItem(
        'pullet:canvas-lab:layout:v1',
        JSON.stringify({ nodes: [{ id: 'fake', data: { text: 'LAB PRIVATE' } }] }),
      );
    },
    { uid: userId, wid: setup.workspace.id, pid: value.id },
  );
  await page.goto('/');
  await page.getByRole('button', { name: `打开项目 ${value.title}`, exact: true }).click();
  await expect(page.getByRole('main', { name: '创作画布', exact: true })).toBeVisible();
}
async function createBoard(page: Page, title: string) {
  await page.getByRole('textbox', { name: '画布名称', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建画布', exact: true }).click();
  await expect(page.getByLabel('当前画布名称', { exact: true })).toHaveValue(title);
  return (await page.url()).split('#canvas/')[1];
}
test('project main view keeps drafts and isolates modal focus and clipboard input', async ({ page }) => {
  const value = await project('Project workspace');
  await open(page, value);
  const workspace = page.getByRole('main', { name: '创作画布', exact: true });
  await expect(workspace).toBeFocused();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.locator('.v2-project-shell')).toHaveCount(0);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const id = await createBoard(page, 'Main view');
  await expectReadable(page.getByRole('button', { name: '资源库', exact: true }));
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`#canvas/${id}$`));
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: '返回工作台', exact: true })).toBeInViewport();
    await expect(page.locator('.creative-surface')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/project-main-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const prompts = page.getByRole('button', { name: '提示词库', exact: true });
  await prompts.click();
  const library = page.getByRole('dialog', { name: '项目提示词库', exact: true });
  await expect(library).toBeVisible();
  const transfer = await localTransfer(page, [
    { name: 'modal-clipboard.png', fixture: 'image.png', type: 'image/png' },
  ]);
  await library.evaluate((element, transfer) => {
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, transfer);
  await expect(page.getByRole('dialog', { name: '导入到画布', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(library).toHaveCount(0);
  await expect(prompts).toBeFocused();
  await expect(workspace).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  await page.getByRole('button', { name: '保存画布', exact: true }).hover();
  await expectReadable(page.getByRole('button', { name: '保存画布', exact: true }));
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  const leave = page.getByRole('dialog', { name: '保留当前创作', exact: true });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await save(page);
  await page.reload();
  await expect(page.getByLabel('当前画布名称')).toHaveValue('Main view');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('button', { name: '深色画布', exact: true }).click();
  await page.getByLabel('当前画布名称').fill('Main view contrast');
  await page.getByRole('button', { name: '保存画布', exact: true }).hover();
  await expectReadable(page.getByRole('button', { name: '保存画布', exact: true }));
  await page.getByLabel('当前画布名称').fill('Main view');
  await page.screenshot({ path: 'test-results/project-main-dark.png' });
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await expect(page.getByRole('button', { name: `打开项目 ${value.title}`, exact: true })).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});
test('resource filters search the full project and ignore stale pages after a category switch', async ({
  page,
}) => {
  const value = await project('Filtered resource library');
  for (let i = 0; i < 21; i++) await uploadMedia(value.id, 'image.png');
  await uploadMedia(value.id, 'clip.mp4');
  await uploadMedia(value.id, 'sound.wav');
  await open(page, value);
  await createBoard(page, 'Filtered references');
  const sources = page.getByRole('complementary', { name: '正式项目资源' });
  const cards = sources.locator('.creative-source-list .creative-source-card');
  await expect(sources.getByRole('button', { name: '媒体', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(cards).toHaveCount(20);
  const filters = sources.getByRole('group', { name: '媒体类型筛选' });
  await filters.getByRole('button', { name: '视频', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('clip.mp4');
  await sources.getByLabel('搜索画布资源').fill('image');
  await expect(cards).toHaveCount(0);
  await expect(sources.getByText('没有匹配的资源', { exact: true })).toBeVisible();
  await sources.getByLabel('搜索画布资源').clear();
  await filters.getByRole('button', { name: '音频', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('sound.wav');
  await filters.getByRole('button', { name: '全部', exact: true }).click();
  await expect(cards).toHaveCount(20);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/board-sources?*', async (route) => {
    if (!new URL(route.request().url()).searchParams.has('cursor')) return route.continue();
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await sources.getByRole('button', { name: '更多项目资源', exact: true }).click();
    await pending;
    await filters.getByRole('button', { name: '视频', exact: true }).click();
    await expect(cards).toHaveCount(1);
    const response = page.waitForResponse(
      (r) => r.url().includes('board-sources') && new URL(r.url()).searchParams.has('cursor'),
    );
    release();
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('clip.mp4');
    await expect(sources.getByRole('button', { name: '更多项目资源', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/resource-library-filtered.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '资源库', exact: true }).click();
    await expect(filters.getByRole('button', { name: '视频', exact: true })).toBeInViewport();
    await page.screenshot({ path: 'test-results/resource-library-mobile.png' });
  } finally {
    release();
  }
});

test('inline prompt selection pins the displayed revision and keeps drafts on failed reads', async ({
  page,
}) => {
  const value = await project('Inline prompt choices');
  const positive = 'A camera moves gently through an empty coastal station. '.repeat(80);
  const body = {
    title: 'Coastal dolly',
    positivePrompt: positive,
    negativePrompt: 'No lettering or watermarks',
    source: 'Visual studies',
  };
  const entry = await call('POST', `/projects/${value.id}/prompt-library`, body);
  await open(page, value);
  const boardId = await createBoard(page, 'Prompt choices');
  await page.getByRole('button', { name: '添加生成节点', exact: true }).click();
  const panel = page.getByRole('region', { name: '生成节点设置' });
  // No workflow is required to prepare a prompt; configuration still loads from the real API.
  await expect(panel.getByLabel('生成提示词')).toBeEnabled();
  await panel.getByLabel('生成提示词').fill('Keep this local draft');
  await panel.getByRole('button', { name: '应用提示词库', exact: true }).click();
  const picker = panel.getByRole('region', { name: '快速选择提示词' });
  await expect(page.getByRole('dialog', { name: '项目提示词库' })).toHaveCount(0);
  await picker.getByLabel('快速搜索提示词').fill('coastal');
  await picker.getByRole('button', { name: /Coastal dolly/ }).click();
  await expect(picker.locator('.v2-prompt-picker-preview > p')).toHaveText(positive.trim());
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await picker.getByRole('button', { name: '复制正向', exact: true }).click();
  await expect(picker.getByRole('status')).toContainText('已复制完整提示词');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(positive.trim());
  await call('POST', `/prompt-library/${entry.revision.entryId}/revisions`, {
    ...body,
    expectedVersion: 1,
    positivePrompt: 'A different second revision',
  });
  await page.screenshot({ path: 'test-results/prompt-inline-desktop.png' });
  await picker.getByRole('button', { name: '应用到当前节点', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(panel.getByLabel('生成提示词')).toHaveValue(positive.trim());
  await save(page);
  const board = await call('GET', `/boards/${boardId}`);
  const promptBinding = board.layout.edges.find((item: any) => item.targetPort === 'prompt');
  const note = board.layout.nodes.find((item: any) => item.id === promptBinding.source);
  expect(note.data.prompt.promptLibraryRevisionId).toBe(entry.revision.id);
  expect(note.data.prompt.negativePrompt).toBe(body.negativePrompt);
  expect((await call('GET', `/projects/${value.id}/generation-jobs`)).items).toHaveLength(0);
  await panel.getByRole('button', { name: '应用提示词库', exact: true }).click();
  await picker.getByRole('button', { name: /Coastal dolly/ }).click();
  await page.route(`**/prompt-library/${entry.revision.entryId}/revisions/2`, (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'FORBIDDEN', message: '此提示词已不可访问' }),
    }),
  );
  await picker.getByRole('button', { name: '应用到当前节点', exact: true }).click();
  await expect(picker.getByRole('alert')).toContainText('此提示词已不可访问');
  await expect(picker.locator('.v2-prompt-picker-preview')).toHaveCount(0);
  await expect(panel.getByLabel('生成提示词')).toHaveValue(positive.trim());
  await page.unroute(`**/prompt-library/${entry.revision.entryId}/revisions/2`);
  await picker.getByRole('button', { name: '重新加载提示词', exact: true }).click();
  await picker.getByRole('button', { name: /Coastal dolly/ }).click();
  await expect(picker.getByRole('alert')).toHaveCount(0);
  await picker.getByRole('button', { name: '收起提示词选择', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole('button', { name: '应用提示词库', exact: true }).click();
  await picker.getByRole('button', { name: /Coastal dolly/ }).click();
  await picker.getByRole('button', { name: '应用到当前节点', exact: true }).scrollIntoViewIfNeeded();
  await expect(picker.getByRole('button', { name: '应用到当前节点', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/prompt-inline-mobile.png' });
});

test('actual browser zoom preserves canvas, inline prompts and save at 125 and 150 percent', async ({
  playwright,
}, testInfo) => {
  const value = await project('Browser zoom acceptance');
  await uploadMedia(value.id, 'image.png');
  await call('POST', `/projects/${value.id}/prompt-library`, {
    title: 'Window light',
    positivePrompt: 'A quiet coastal station in soft morning light',
    negativePrompt: 'no lettering',
  });
  const { context, setZoom } = await zoomBrowser(playwright.chromium, testInfo.outputPath('zoom-browser'));
  try {
    const page = await context.newPage();
    await open(page, value);
    await createBoard(page, 'Zoomed creation');
    await page.getByRole('button', { name: '添加 image.png', exact: true }).click();
    await page.getByRole('button', { name: '以此图生成', exact: true }).click();
    const panel = page.getByRole('region', { name: '生成节点设置' });
    for (const factor of [1.25, 1.5]) {
      expect(await setZoom(page.url(), factor)).toBe(factor);
      expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(Math.round(1440 / factor));
      await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBe(factor);
      await panel.getByRole('button', { name: '应用提示词库', exact: true }).click();
      const picker = panel.getByRole('region', { name: '快速选择提示词' });
      await picker.getByRole('button', { name: /Window light/ }).click();
      await picker.getByRole('button', { name: '应用到当前节点', exact: true }).click();
      await expect(panel.getByLabel('生成提示词')).toHaveValue(
        'A quiet coastal station in soft morning light',
      );
      await expect(page.getByRole('button', { name: '保存画布', exact: true })).toBeInViewport();
      await save(page);
      await panel.getByRole('button', { name: '应用提示词库', exact: true }).click();
      await picker.getByRole('button', { name: /Window light/ }).click();
      await picker.getByRole('button', { name: '应用到当前节点', exact: true }).scrollIntoViewIfNeeded();
      await expect(picker.getByRole('button', { name: '应用到当前节点', exact: true })).toBeInViewport();
      await expect(page.locator('.creative-surface')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/browser-zoom-${Math.round(factor * 100)}.png` });
      await picker.getByRole('button', { name: '收起提示词选择', exact: true }).click();
      await page.getByRole('button', { name: '预览 image.png', exact: true }).click();
      const resourcePreview = page.getByRole('region', { name: '资源预览' });
      await expect(resourcePreview.getByRole('img')).toBeVisible();
      await expect(resourcePreview.getByRole('button', { name: '返回资源列表' })).toBeInViewport();
      await page.screenshot({ path: `test-results/resource-preview-zoom-${Math.round(factor * 100)}.png` });
      await resourcePreview.getByRole('button', { name: '返回资源列表' }).click();
      if (factor === 1.25) await page.getByRole('button', { name: '深色画布', exact: true }).click();
    }
  } finally {
    await context.close();
  }
});

test('resource previews keep fixed media outside the canvas and let read-only users inspect files', async ({
  page,
}) => {
  const value = await project('Resource preview studies');
  const image = await uploadMedia(value.id, 'image.png');
  await uploadMedia(value.id, 'clip.mp4');
  await uploadMedia(value.id, 'sound.wav');
  await open(page, value);
  const id = await createBoard(page, 'Preview without pinning');
  const sources = page.getByRole('complementary', { name: '正式项目资源' });
  const preview = sources.getByRole('region', { name: '资源预览' });
  await sources.getByRole('button', { name: '预览 image.png', exact: true }).click();
  await expect(preview.getByRole('img', { name: '项目资源预览' })).toBeVisible();
  await expect(preview).toContainText('96×64');
  expect((await call('GET', `/boards/${id}`)).layout.nodes).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(sources.getByRole('button', { name: '预览 image.png', exact: true })).toBeFocused();
  await sources.getByRole('button', { name: '预览 clip.mp4', exact: true }).click();
  await expect
    .poll(() => preview.locator('video').evaluate((element: HTMLVideoElement) => element.videoWidth))
    .toBe(96);
  const download = await owner.get(
    (await preview.getByRole('link', { name: '下载固定版本原件' }).getAttribute('href')) as string,
  );
  expect(download.ok()).toBeTruthy();
  expect(await download.body()).toEqual(fixtures['clip.mp4'].bytes);
  await page.screenshot({ path: 'test-results/source-preview-video.png' });
  await preview.getByRole('button', { name: '返回资源列表' }).click();
  await expect(sources.locator('video')).toHaveCount(0);
  await sources.getByRole('button', { name: '预览 sound.wav', exact: true }).click();
  await expect(preview.locator('audio')).toBeVisible();
  await preview.getByRole('button', { name: '返回资源列表' }).click();
  await page.route(`**${image.contentUrl}`, (route) => route.abort());
  await sources.getByRole('button', { name: '预览 image.png', exact: true }).click();
  await expect(preview.getByRole('alert')).toContainText('预览无法读取');
  await expect(preview.locator('img')).toHaveCount(0);
  await expect(preview.getByRole('link')).toHaveCount(0);
  await page.unroute(`**${image.contentUrl}`);
  await preview.getByRole('button', { name: '重新读取预览' }).click();
  await expect(preview.getByRole('img')).toBeVisible();
  await preview.getByRole('button', { name: '添加到画布', exact: true }).click();
  await expect(preview.getByRole('status')).toContainText('已添加到画布草稿');
  await save(page);
  const saved = await call('GET', `/boards/${id}`);
  expect(saved.layout.nodes[0].data.ref.id).toBe(image.id);
  const invite = await call('POST', `/workspaces/${setup.workspace.id}/invitations`, {
    email: `preview-${randomUUID()}@board.test`,
  });
  const reader = await request.newContext({ baseURL: 'http://127.0.0.1:5192' });
  try {
    const joined = await (
      await reader.post('/api/v1/invitations/accept', {
        data: { token: invite.token, name: 'Preview reader', password: 'Studio8!' },
        headers: { 'X-Studio-Request': '1' },
      })
    ).json();
    await call('POST', `/projects/${value.id}/members`, { userId: joined.user.id, role: 'VIEWER' });
    await page.goto('about:blank');
    await open(page, value, reader, joined.user.id);
    await expect(sources.getByRole('button', { name: '添加 image.png', exact: true })).toBeDisabled();
    await sources.getByRole('button', { name: '预览 image.png', exact: true }).click();
    await expect(preview.getByRole('img')).toBeVisible();
    await expect(preview.getByRole('button', { name: '添加到画布', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '资源库', exact: true }).click();
    await sources.getByRole('button', { name: '预览 image.png', exact: true }).click();
    await expect(preview.getByRole('img')).toBeVisible();
    await page.screenshot({ path: 'test-results/source-preview-readonly-mobile.png' });
    await call('DELETE', `/projects/${value.id}/members/${joined.user.id}`, { expectedRole: 'VIEWER' });
    await preview.getByRole('button', { name: '返回资源列表' }).click();
    await sources.getByRole('button', { name: '预览 image.png', exact: true }).click();
    await expect(page.getByRole('main', { name: '创作画布' })).toContainText('画布或项目已不可访问');
    expect((await call('GET', `/boards/${id}`)).layout).toEqual(saved.layout);
  } finally {
    await reader.dispose();
  }
});

test('asset previews pin historical revisions and individual reference media', async ({ page }) => {
  const value = await project('Asset revision selection');
  const front = await uploadMedia(value.id, 'image.png');
  const side = await uploadMedia(value.id, 'image.jpg');
  const body = {
    name: 'Harbor keeper',
    description: 'A practical coat for the morning watch.',
    attributes: {},
    media: [
      { role: 'front', mediaVersionId: front.id },
      { role: 'side', mediaVersionId: side.id },
    ],
  };
  const original = await call('POST', `/projects/${value.id}/entities`, { kind: 'character', body });
  for (let version = 1; version < 22; version++)
    await call('POST', `/entities/${original.id}/revisions`, {
      expectedVersion: version,
      body: { ...body, name: `Harbor keeper ${version + 1}` },
    });
  await open(page, value);
  const id = await createBoard(page, 'Choose costume and reference');
  const sources = page.getByRole('complementary', { name: '正式项目资源' });
  const preview = sources.getByRole('region', { name: '资源预览' });
  await sources.getByRole('button', { name: '资产', exact: true }).click();
  await expect(sources.getByRole('button', { name: '添加 Harbor keeper 22', exact: true })).toContainText(
    body.description,
  );
  await sources.getByRole('button', { name: '预览 Harbor keeper 22', exact: true }).click();
  const versions = preview.getByLabel('资产固定版本', { exact: true });
  await expect(versions.locator('option')).toHaveCount(20);
  await preview.getByRole('button', { name: '更早的资产版本', exact: true }).click();
  await expect(versions.locator('option')).toHaveCount(22);
  await versions.selectOption(original.revision.id);
  await expect(preview.getByRole('heading', { name: 'Harbor keeper', exact: true })).toBeVisible();
  await versions.focus();
  await page.keyboard.press('Home');
  await expect(preview.getByRole('heading', { name: 'Harbor keeper 22', exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(preview.getByRole('heading', { name: 'Harbor keeper', exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '预览侧面：image.jpg', exact: true }).click();
  await expect(preview.getByRole('img', { name: '项目资源预览' })).toHaveAttribute('src', side.contentUrl);
  await preview.getByRole('button', { name: '添加此资产版本', exact: true }).click();
  await preview.getByRole('button', { name: '添加此参考素材', exact: true }).click();
  await expect(preview.getByRole('status')).toContainText('已添加参考素材');
  const inspector = page.getByRole('complementary', { name: '画布检查器' });
  const actionBounds = await inspector.getByRole('button', { name: '以此图生成', exact: true }).boundingBox();
  const titleBounds = await inspector.locator(':scope > strong').boundingBox();
  expect(actionBounds!.y + actionBounds!.height).toBeLessThanOrEqual(titleBounds!.y);
  await save(page);
  const saved = await call('GET', `/boards/${id}`);
  expect(saved.layout.nodes.map((node: any) => node.data.ref)).toEqual([
    { kind: 'entity', id: original.id, revisionId: original.revision.id },
    { kind: 'media', id: side.id },
  ]);
  expect(saved.resolved[saved.layout.nodes[0].id].media.id).toBe(front.id);
  const latest = await call('POST', `/entities/${original.id}/revisions`, { expectedVersion: 22, body });
  await page.screenshot({ path: 'test-results/asset-reference-desktop-light.png' });
  await page.getByRole('button', { name: '深色画布', exact: true }).click();
  await page.screenshot({ path: 'test-results/asset-reference-desktop-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '资源库', exact: true }).click();
  await sources.getByRole('button', { name: '资产', exact: true }).click();
  await sources.getByRole('button', { name: '预览 Harbor keeper', exact: true }).click();
  await preview.getByRole('button', { name: '添加此资产版本' }).scrollIntoViewIfNeeded();
  await expect(preview.getByRole('button', { name: '添加此资产版本' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/asset-reference-mobile-dark.png', animations: 'disabled' });
  await page.getByRole('button', { name: '浅色画布', exact: true }).click();
  await page.screenshot({ path: 'test-results/asset-reference-mobile-light.png', animations: 'disabled' });
  await page.reload();
  const restored = await call('GET', `/boards/${id}`);
  expect(restored.layout).toEqual(saved.layout);
  expect(restored.resolved[saved.layout.nodes[0].id].version).toBe(1);
  expect(restored.resolved[saved.layout.nodes[0].id].currentVersion).toBe(latest.currentVersion);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(`.react-flow__node[data-id="${saved.layout.nodes[1].id}"]`).click();
  await page.keyboard.press('Delete');
  await save(page);
  expect((await call('GET', `/boards/${id}`)).layout.nodes).toHaveLength(1);
  expect((await owner.get(side.contentUrl)).ok()).toBe(true);
});

test('asset preview switching rejects stale responses and preserves explicit choices on failure', async ({
  page,
}) => {
  const value = await project('Asset switching boundaries');
  const front = await uploadMedia(value.id, 'image.png');
  const body = {
    name: 'Harbor study',
    description: '',
    attributes: {},
    media: [{ role: 'front', mediaVersionId: front.id }],
  };
  const original = await call('POST', `/projects/${value.id}/entities`, { kind: 'character', body });
  const latest = await call('POST', `/entities/${original.id}/revisions`, {
    expectedVersion: 1,
    body: { ...body, name: 'Harbor study latest' },
  });
  await open(page, value);
  await createBoard(page, 'Switching reference versions');
  const sources = page.getByRole('complementary', { name: '正式项目资源' });
  const preview = sources.getByRole('region', { name: '资源预览' });
  await sources.getByRole('button', { name: '资产', exact: true }).click();
  await page.route(`**/entities/${original.id}/revisions`, (route) =>
    route.fulfill({ status: 503, json: { message: 'History temporarily unavailable' } }),
  );
  await sources.getByRole('button', { name: '预览 Harbor study latest', exact: true }).click();
  await expect(preview.getByRole('alert')).toContainText('History temporarily unavailable');
  await page.unroute(`**/entities/${original.id}/revisions`);
  await preview.getByRole('button', { name: '重新读取资产历史' }).click();
  const versions = preview.getByLabel('资产固定版本');
  await expect(versions.locator('option')).toHaveCount(2);
  let release!: () => void, requested!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/board-references/resolve', async (route) => {
    const references = route.request().postDataJSON().references;
    if (references.some((item: any) => item.ref.revisionId === original.revision.id)) {
      const response = await route.fetch();
      requested();
      await released;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await versions.selectOption(original.revision.id);
    await started;
    await expect(preview.getByRole('button', { name: '添加此资产版本' })).toHaveCount(0);
    await versions.selectOption(latest.revision.id);
    await expect(preview.getByRole('heading', { name: 'Harbor study latest', exact: true })).toBeVisible();
    const oldResponse = page.waitForResponse((response) => {
      if (!response.url().endsWith('/board-references/resolve')) return false;
      return response
        .request()
        .postDataJSON()
        .references.some((item: any) => item.ref.revisionId === original.revision.id);
    });
    release();
    await oldResponse;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect(versions).toHaveValue(latest.revision.id);
    await expect(preview.getByRole('heading', { name: 'Harbor study', exact: true })).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await page.route('**/board-references/resolve', (route) =>
    route.fulfill({ status: 503, json: { message: 'Reference temporarily unavailable' } }),
  );
  await versions.selectOption(original.revision.id);
  await expect(preview.getByRole('alert')).toContainText('Reference temporarily unavailable');
  await expect(versions).toHaveValue(original.revision.id);
  await expect(preview.getByRole('img')).toHaveCount(0);
  await expect(preview.getByRole('button', { name: '添加此资产版本' })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
  await preview.getByRole('button', { name: '重新读取预览' }).click();
  await expect(preview.getByRole('heading', { name: 'Harbor study', exact: true })).toBeVisible();
  await expect(versions).toHaveValue(original.revision.id);
  const responseReady = page.waitForResponse((response) =>
    response.url().endsWith('/board-references/resolve'),
  );
  await page.route('**/board-references/resolve', async (route) => {
    const response = await route.fetch();
    await preview.getByRole('button', { name: '返回资源列表' }).click();
    await route.fulfill({ response });
  });
  await preview.getByRole('button', { name: '添加此参考素材' }).click();
  await responseReady;
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
  await sources.getByRole('button', { name: '预览 Harbor study latest', exact: true }).click();
  await expect(preview.getByRole('button', { name: '添加此参考素材' })).toBeVisible();
  await page.route('**/board-references/resolve', async (route) => {
    const response = await route.fetch();
    await page.getByRole('button', { name: '添加便签', exact: true }).click();
    await route.fulfill({ response });
  });
  await preview.getByRole('button', { name: '添加此参考素材' }).click();
  await expect(preview.getByRole('status')).toContainText('已添加参考素材');
  await page.unrouteAll({ behavior: 'wait' });
  await save(page);
  const board = await call('GET', `/boards/${(await page.url()).split('#canvas/')[1]}`);
  expect(board.layout.nodes.map((node: any) => node.type).sort()).toEqual(['note', 'reference']);
});

test('read-only asset history keeps protected voice samples unavailable', async ({ page }) => {
  const value = await project('Asset reader permissions');
  const image = await uploadMedia(value.id, 'image.png');
  const sample = await uploadMedia(value.id, 'sound.wav');
  const original = await call('POST', `/projects/${value.id}/entities`, {
    kind: 'environment',
    body: {
      name: 'Harbor',
      description: 'Before dawn',
      attributes: {},
      media: [{ role: 'overview', mediaVersionId: image.id }],
    },
  });
  await call('POST', `/entities/${original.id}/revisions`, {
    expectedVersion: 1,
    body: {
      name: 'Harbor dawn',
      description: 'At dawn',
      attributes: {},
      media: [{ role: 'overview', mediaVersionId: image.id }],
    },
  });
  const voice = await call('POST', `/projects/${value.id}/entities`, {
    kind: 'voice',
    body: {
      name: 'Narration',
      description: 'PRIVATE SAMPLE DETAILS',
      attributes: {},
      media: [{ role: 'voice_sample', mediaVersionId: sample.id }],
    },
  });
  await call('POST', `/entities/${voice.id}/revisions`, {
    expectedVersion: 1,
    body: { name: 'Narration settings', description: 'Metadata only', attributes: {}, media: [] },
  });
  await open(page, value);
  const id = await createBoard(page, 'Reader reference choices');
  const invite = await call('POST', `/workspaces/${setup.workspace.id}/invitations`, {
    email: `asset-reader-${randomUUID()}@board.test`,
  });
  const reader = await request.newContext({ baseURL: 'http://127.0.0.1:5192' });
  try {
    const accepted = await reader.post('/api/v1/invitations/accept', {
      data: { token: invite.token, name: 'Asset reader', password: 'Studio8!' },
      headers: { 'X-Studio-Request': '1' },
    });
    expect(accepted.ok()).toBeTruthy();
    const joined = await accepted.json();
    await call('POST', `/projects/${value.id}/members`, { userId: joined.user.id, role: 'VIEWER' });
    await page.goto('about:blank');
    await open(page, value, reader, joined.user.id);
    const sources = page.getByRole('complementary', { name: '正式项目资源' });
    const preview = sources.getByRole('region', { name: '资源预览' });
    await sources.getByRole('button', { name: '资产', exact: true }).click();
    await sources.getByRole('button', { name: '预览 Harbor dawn', exact: true }).click();
    await expect(preview.getByLabel('资产固定版本').locator('option')).toHaveCount(2);
    await preview.getByLabel('资产固定版本').selectOption(original.revision.id);
    await expect(preview.getByRole('heading', { name: 'Harbor', exact: true })).toBeVisible();
    await expect(preview.getByRole('button', { name: /^添加/ })).toHaveCount(0);
    await expect(preview.getByRole('img', { name: '项目资源预览' })).toBeVisible();
    await preview.getByRole('button', { name: '返回资源列表' }).click();
    await sources.getByRole('button', { name: '预览 Narration settings', exact: true }).click();
    await expect(preview.getByLabel('资产固定版本').locator('option')).toHaveCount(2);
    await preview.getByLabel('资产固定版本').selectOption(voice.revision.id);
    await expect(preview.getByRole('alert')).toContainText('此资源已不可用');
    await expect(preview).not.toContainText('PRIVATE SAMPLE DETAILS');
    await expect(preview.locator('audio, img, a')).toHaveCount(0);
    const denied = await reader.get(sample.contentUrl);
    expect(denied.status()).toBe(403);
    expect((await call('GET', `/boards/${id}`)).layout.nodes).toHaveLength(0);
    await call('DELETE', `/projects/${value.id}/members/${joined.user.id}`, { expectedRole: 'VIEWER' });
    await preview.getByRole('button', { name: '重新读取预览' }).click();
    await expect(page.getByRole('main', { name: '创作画布' })).toContainText('画布或项目已不可访问');
  } finally {
    await reader.dispose();
  }
});

test('candidate review compares fixed results and keeps selection while new jobs arrive', async ({
  page,
  playwright,
}, testInfo) => {
  const remote = await startComfyMock({ 'clip.mp4': fixtures['clip.mp4'].bytes });
  try {
    const value = await project('Candidate review studies');
    const image = await uploadMedia(value.id, 'image.png');
    const connection = await call('POST', `/projects/${value.id}/generation-connections`, {
      name: 'Review fixture',
      baseUrl: remote.baseUrl,
      trustedPrivate: true,
    });
    const workflow = await call(
      'POST',
      `/projects/${value.id}/generation-workflows`,
      fixtureI2V(connection.id),
    );
    await open(page, value);
    const boardId = await createBoard(page, 'Compare generated motion');
    await page.getByRole('button', { name: '添加 image.png', exact: true }).click();
    await page.getByRole('button', { name: '以此图生成', exact: true }).click();
    const panel = page.getByRole('region', { name: '生成节点设置' });
    await panel.getByLabel('节点工作流').selectOption(workflow.id);
    const jobIds = [];
    for (const prompt of ['A slow camera movement toward the coast', 'A still camera watching the harbor']) {
      await panel.getByLabel('生成提示词').fill(prompt);
      await panel.getByRole('button', { name: '保存并生成', exact: true }).click();
      await expect
        .poll(async () => (await call('GET', `/projects/${value.id}/generation-jobs`)).items.length)
        .toBe(jobIds.length + 1);
      const latest = (await call('GET', `/projects/${value.id}/generation-jobs`)).items[0];
      await expect
        .poll(async () => (await call('GET', `/generation-jobs/${latest.id}`)).state, { timeout: 20000 })
        .toBe('completed');
      jobIds.push(latest.id);
      await panel.getByRole('button', { name: '刷新节点任务', exact: true }).click();
      await expect(panel.getByRole('article', { name: '当前候选', exact: true })).toHaveAttribute(
        'data-job-id',
        latest.id,
      );
    }
    await panel.getByText(/历史任务 ·/).click();
    await panel.getByRole('button', { name: `查看候选 ${jobIds[0]}`, exact: true }).click();
    const primary = panel.getByRole('article', { name: '当前候选', exact: true });
    const secondary = panel.getByRole('article', { name: '对照结果', exact: true });
    await expect(primary).toHaveAttribute('data-job-id', jobIds[0]);
    await panel.getByRole('button', { name: '对照结果', exact: true }).click();
    await expect(secondary).toHaveAttribute('data-job-id', jobIds[1]);
    await expect(panel.locator('video')).toHaveCount(2);
    await expect
      .poll(() => primary.locator('video').evaluate((element: HTMLVideoElement) => element.videoWidth))
      .toBe(96);
    await expect
      .poll(() => secondary.locator('video').evaluate((element: HTMLVideoElement) => element.videoWidth))
      .toBe(96);
    await primary.getByText('此次生成记录', { exact: true }).click();
    await expect(primary).toContainText('A slow camera movement toward the coast');
    await panel.getByRole('button', { name: '本节点任务', exact: true }).click();
    await page.screenshot({ path: 'test-results/candidates-compare-desktop.png' });
    const head = await call('GET', `/boards/${boardId}`);
    const nodeId = head.layout.nodes.find((item: any) => item.type === 'generation').id;
    const path = `/boards/${boardId}/nodes/${nodeId}/generation-jobs`;
    const third = await call('POST', path, { expectedRevision: head.revision, confirmed: true });
    await expect
      .poll(async () => (await call('GET', `/generation-jobs/${third.id}`)).state, { timeout: 20000 })
      .toBe('completed');
    await panel.getByRole('button', { name: '刷新节点任务', exact: true }).click();
    await expect(panel.getByRole('button', { name: `查看候选 ${third.id}` })).toBeVisible();
    await expect(primary).toHaveAttribute('data-job-id', jobIds[0]);
    await expect(secondary).toHaveAttribute('data-job-id', jobIds[1]);
    await primary.getByRole('button', { name: '存入素材库', exact: true }).click();
    await expect(primary.getByText('已存入素材库', { exact: true })).toBeVisible();
    expect((await call('GET', `/generation-jobs/${jobIds[1]}`)).inLibrary).toBe(false);
    await primary.getByRole('button', { name: '加入画布结果', exact: true }).click();
    await expect(primary.getByRole('button', { name: '加入画布结果', exact: true })).toBeDisabled();
    await primary.getByRole('button', { name: '复用此次提示词', exact: true }).click();
    await expect(panel.getByLabel('生成提示词')).toHaveValue('A slow camera movement toward the coast');
    await save(page);
    const saved = await call('GET', `/boards/${boardId}`);
    expect(
      saved.layout.nodes.filter((item: any) => item.type === 'result').map((item: any) => item.data.jobId),
    ).toEqual([jobIds[0]]);
    expect(saved.layout.nodes.find((item: any) => item.type === 'reference').data.ref.id).toBe(image.id);
    expect((await call('GET', `/generation-jobs/${jobIds[1]}`)).prompt.positivePrompt).toBe(
      'A still camera watching the harbor',
    );
    expect((await call('GET', `/projects/${value.id}/generation-jobs`)).items).toHaveLength(3);
    await page.getByRole('button', { name: '深色画布', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await primary.getByRole('button', { name: '复用此次提示词', exact: true }).scrollIntoViewIfNeeded();
    await expect(primary.getByRole('button', { name: '复用此次提示词', exact: true })).toBeInViewport();
    await page.screenshot({ path: 'test-results/candidates-compare-mobile.png' });
    await panel.getByRole('button', { name: '结束对照', exact: true }).click();
    await expect(panel.locator('video')).toHaveCount(1);
    const { context, setZoom } = await zoomBrowser(
      playwright.chromium,
      testInfo.outputPath('candidate-zoom'),
    );
    try {
      const zoomed = await context.newPage();
      await open(zoomed, value);
      await expect(zoomed.getByLabel('当前画布名称')).toHaveValue('Compare generated motion');
      await zoomed.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
      const review = zoomed.getByRole('region', { name: '生成节点设置' });
      await review.getByText(/历史任务 ·/).click();
      await review.getByRole('button', { name: `查看候选 ${jobIds[0]}`, exact: true }).click();
      await review.getByRole('button', { name: '对照结果', exact: true }).click();
      for (const factor of [1.25, 1.5]) {
        expect(await setZoom(zoomed.url(), factor)).toBe(factor);
        await expect.poll(() => zoomed.evaluate(() => innerWidth)).toBe(Math.round(1440 / factor));
        const active = review.getByRole('article', { name: '当前候选', exact: true });
        await active.getByRole('button', { name: '复用此次提示词' }).scrollIntoViewIfNeeded();
        await expect(active.getByRole('button', { name: '复用此次提示词' })).toBeInViewport();
        await expect(review.locator('video')).toHaveCount(2);
        expect(await zoomed.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await zoomed.screenshot({ path: `test-results/candidate-zoom-${Math.round(factor * 100)}.png` });
        if (factor === 1.25) await zoomed.getByRole('button', { name: '深色画布' }).click();
      }
    } finally {
      await context.close();
    }
  } finally {
    await remote.close();
  }
});

test('project gallery restores its own board when a link points to another project', async ({ page }) => {
  const first = await project('Gallery station');
  const second = await project('Gallery skyline');
  await call('POST', `/projects/${first.id}/boards`, { title: 'Earlier station' });
  const foreign = await call('POST', `/projects/${second.id}/boards`, { title: 'Skyline only' });
  await open(page, first);
  await expect(page.getByLabel('当前画布名称')).toHaveValue('Earlier station');
  await page.getByRole('button', { name: '切换 / 新建画布', exact: true }).click();
  const remembered = await createBoard(page, 'Selected station');
  await call('POST', `/projects/${first.id}/boards`, { title: 'Newest station' });
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索项目' });
  await search.fill('Gallery station');
  await expect(page.getByRole('button', { name: '打开项目 Gallery skyline' })).toHaveCount(0);
  await search.clear();
  await expect(page.getByRole('button', { name: '打开项目 Gallery skyline' })).toBeVisible();
  await page.screenshot({ path: 'test-results/studio-live-gallery-desktop.png' });
  await page.goto(`/#canvas/${foreign.id}`);
  await page.reload();
  await expect(page.getByLabel('当前画布名称')).toHaveValue('Selected station');
  await expect(page).toHaveURL(new RegExp(`#canvas/${remembered}$`));
  await expect(page.getByText('Skyline only', { exact: true })).toHaveCount(0);
});

async function save(page: Page) {
  await page.getByRole('button', { name: '保存画布', exact: true }).click();
  await expect(page.locator('.creative-save-state')).toContainText('已保存');
}
async function localTransfer(page: Page, files: { name: string; fixture: string; type: string }[]) {
  return page.evaluateHandle(
    (entries) => {
      const transfer = new DataTransfer();
      for (const entry of entries)
        transfer.items.add(new File([new Uint8Array(entry.bytes)], entry.name, { type: entry.type }));
      return transfer;
    },
    files.map((file) => ({ ...file, bytes: [...fixtures[file.fixture].bytes] })),
  );
}
async function dropFiles(page: Page, transfer: any) {
  const surface = page.locator('.creative-surface');
  const box = (await surface.boundingBox())!;
  await surface.dispatchEvent('dragenter', { dataTransfer: transfer });
  await surface.dispatchEvent('dragover', { dataTransfer: transfer });
  await surface.dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + 260, clientY: box.y + 130 });
}
async function pasteFiles(page: Page, transfer: any) {
  return page.evaluate((transfer) => {
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
    document.querySelector('.creative-surface')!.dispatchEvent(event);
    return event.defaultPrevented;
  }, transfer);
}
test('local media drops and image paste create fixed references while text controls keep their paste', async ({
  page,
}) => {
  const value = await project('Direct import');
  await open(page, value);
  const id = await createBoard(page, 'Local references');
  await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  await save(page);
  const before = await call('GET', `/boards/${id}`);
  const transfer = await localTransfer(page, [
    { name: 'local-image.png', fixture: 'image.png', type: 'image/png' },
    { name: 'local-video.mp4', fixture: 'clip.mp4', type: 'video/mp4' },
    { name: 'local-audio.wav', fixture: 'sound.wav', type: 'audio/wav' },
  ]);
  await dropFiles(page, transfer);
  await expect(page.getByRole('status').filter({ hasText: '素材已导入并加入画布' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '导入到画布', exact: true })).toHaveCount(0);
  await save(page);
  const board = await call('GET', `/boards/${id}`);
  expect(board.layout.nodes).toHaveLength(3);
  expect(board.layout.nodes[0].position.x).toBeCloseTo(
    (260 - before.layout.viewport.x) / before.layout.viewport.zoom,
    1,
  );
  expect(board.layout.nodes[0].position.y).toBeCloseTo(
    (130 - before.layout.viewport.y) / before.layout.viewport.zoom,
    1,
  );
  expect(
    Object.values(board.resolved)
      .map((item: any) => item.media.mediaType)
      .sort(),
  ).toEqual(['audio', 'image', 'video']);
  const image = await localTransfer(page, [
    { name: 'clipboard.png', fixture: 'image.png', type: 'image/png' },
  ]);
  expect(await pasteFiles(page, image)).toBeTruthy();
  await expect(page.getByRole('dialog', { name: '导入到画布', exact: true })).toHaveCount(0);
  await expect(page.locator('.creative-surface img[alt="clipboard.png"]')).toBeVisible();
  await save(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入本地文件', exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: 'picked.png', mimeType: 'image/png', buffer: fixtures['image.png'].bytes });
  await expect(page.locator('.creative-surface img[alt="picked.png"]')).toBeVisible();
  await save(page);
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  await page.getByLabel('画布文字内容').fill('Preserve this note');
  const intercepted = await page.evaluate((transfer) => {
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
    document.querySelector('[aria-label="画布文字内容"]')!.dispatchEvent(event);
    return event.defaultPrevented;
  }, image);
  expect(intercepted).toBeFalsy();
  await expect(page.getByLabel('画布文字内容')).toHaveValue('Preserve this note');
  await expect(page.getByRole('dialog', { name: '导入到画布', exact: true })).toHaveCount(0);
  await save(page);
  await page.reload();
  await expect(page.getByLabel('当前画布名称')).toHaveValue('Local references');
  const nodes = (await call('GET', `/boards/${id}`)).layout.nodes;
  expect(nodes).toHaveLength(6);
  for (const [index, node] of nodes.entries())
    for (const other of nodes.slice(index + 1))
      expect(
        node.position.x < other.position.x + other.width &&
          node.position.x + node.width > other.position.x &&
          node.position.y < other.position.y + other.height &&
          node.position.y + node.height > other.position.y,
      ).toBeFalsy();
  const media = await call('GET', `/projects/${value.id}/media-assets`);
  expect(media.items).toHaveLength(5);
  await page.screenshot({ path: 'test-results/canvas-direct-import.png' });
});

test('video cards load on demand, release the previous player and preserve fixed references', async ({
  page,
}) => {
  const value = await project('Video card previews');
  await open(page, value);
  const id = await createBoard(page, 'Video references');
  const transfer = await localTransfer(page, [
    { name: 'preview-one.mp4', fixture: 'clip.mp4', type: 'video/mp4' },
    { name: 'preview-two.mp4', fixture: 'clip.mp4', type: 'video/mp4' },
  ]);
  await dropFiles(page, transfer);
  await expect(page.getByRole('status').filter({ hasText: '素材已导入并加入画布' })).toBeVisible();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await save(page);
  const before = await call('GET', `/boards/${id}`);
  const surface = page.locator('.creative-surface');
  await expect(surface.locator('video')).toHaveCount(0);
  await expect(surface.locator('.creative-media-duration')).toHaveText(['0:01', '0:01']);
  await surface.getByRole('button', { name: '播放 preview-one.mp4', exact: true }).click();
  const first = surface.locator('video[aria-label="视频预览 preview-one.mp4"]');
  await expect
    .poll(() => first.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await first.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(96);
  await surface.getByRole('button', { name: '播放 preview-two.mp4', exact: true }).click();
  await expect(surface.locator('video')).toHaveCount(1);
  await expect(page.locator('.creative-inspector')).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(1);
  await expect(first).toHaveCount(0);
  await expect(surface.getByRole('button', { name: '播放 preview-one.mp4', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/project-video-inline.png' });
  await surface.getByRole('button', { name: '关闭预览 preview-two.mp4', exact: true }).click();
  await expect(surface.locator('video')).toHaveCount(0);
  const media = Object.values(before.resolved).find((item: any) => item.title === 'preview-one.mp4') as any;
  await page.route(`**${media.media.contentUrl}`, (route) => route.abort());
  await surface.getByRole('button', { name: '播放 preview-one.mp4', exact: true }).click();
  await expect(surface.getByRole('status')).toContainText('视频无法播放');
  await expect(surface.locator('video')).toHaveCount(0);
  expect((await call('GET', `/boards/${id}`)).layout).toEqual(before.layout);
  await page.unroute(`**${media.media.contentUrl}`);
  await page.reload();
  await expect(page.getByLabel('当前画布名称')).toHaveValue('Video references');
  await expect(surface.locator('video')).toHaveCount(0);
  expect((await call('GET', `/boards/${id}`)).layout).toEqual(before.layout);
});

test('direct imports reuse upload intents after failed and lost responses', async ({ page }) => {
  const value = await project('Recover direct imports');
  await open(page, value);
  const id = await createBoard(page, 'Recover media');
  const dialog = page.getByRole('dialog', { name: '导入到画布', exact: true });
  for (const [index, mode] of ['content-failed', 'content-lost', 'intent-lost'].entries()) {
    let dropped = false;
    const routePath =
      mode === 'intent-lost' ? `**/projects/${value.id}/media-uploads` : '**/media-uploads/*/content';
    await page.route(routePath, async (route) => {
      if (!dropped && route.request().method() === (mode === 'intent-lost' ? 'POST' : 'PUT')) {
        dropped = true;
        if (mode !== 'content-failed') await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await dropFiles(
      page,
      await localTransfer(page, [{ name: `${mode}.png`, fixture: 'image.png', type: 'image/png' }]),
    );
    if (mode !== 'content-lost') {
      await expect(dialog.getByRole('alert')).toBeVisible();
      if (index === 0) {
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
        await page.screenshot({ path: 'test-results/direct-import-mobile.png' });
      }
      await page.screenshot({ path: `test-results/direct-import-${mode}.png` });
      await dialog.getByRole('button', { name: '重试未完成', exact: true }).click();
    }
    await expect(page.locator(`.creative-surface img[alt="${mode}.png"]`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await page.unroute(routePath);
    await save(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect((await call('GET', `/boards/${id}`)).layout.nodes).toHaveLength(index + 1);
    expect((await call('GET', `/projects/${value.id}/media-assets`)).items).toHaveLength(index + 1);
    expect((await call('GET', `/projects/${value.id}/media-uploads`)).items).toHaveLength(index + 1);
  }
  await dropFiles(
    page,
    await localTransfer(page, [{ name: 'unsupported.txt', fixture: 'image.png', type: 'text/plain' }]),
  );
  await expect(dialog.getByRole('alert')).toContainText('不支持此文件格式');
  await dialog.getByRole('button', { name: '关闭导入', exact: true }).click();
  expect((await call('GET', `/projects/${value.id}/media-uploads`)).items).toHaveLength(3);
  await dropFiles(
    page,
    await localTransfer(
      page,
      Array.from({ length: 21 }, (_, index) => ({
        name: `many-${index}.png`,
        fixture: 'image.png',
        type: 'image/png',
      })),
    ),
  );
  await expect(page.getByRole('alert')).toContainText('一次最多导入20份文件');
  await expect(dialog).toHaveCount(0);
  expect((await call('GET', `/projects/${value.id}/media-uploads`)).items).toHaveLength(3);
});

test('a new project imports media and a workflow, generates and shares its result through the UI', async ({
  page,
  browser,
}) => {
  // Original repo artwork is only test input, imported through the production media API.
  // The output clip is synthetic and supplied by Mock ComfyUI, not a model-quality claim.
  const artwork = await browser.newPage({ viewport: { width: 960, height: 540 } });
  let reference: Buffer;
  try {
    await artwork.setContent(
      '<style>html,body{margin:0}</style>' +
        (await readFile(resolve('apps/web/src/design-review/art/tide.svg'), 'utf8')),
    );
    reference = await artwork.screenshot();
  } finally {
    await artwork.close();
  }
  const remote = await startComfyMock({
    'clip.mp4': await readFile(resolve('apps/web/src/design-review/art/shore-preview.mp4')),
  });
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  try {
    await page.context().addCookies((await owner.storageState()).cookies);
    await page.addInitScript(
      ({ userId, workspaceId }) => {
        localStorage.setItem(`pullet.workspace.${userId}`, workspaceId);
      },
      { userId: setup.user.id, workspaceId: setup.workspace.id },
    );
    await page.goto('/');
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    const create = page.getByRole('dialog', { name: '新建项目', exact: true });
    await expect(create).toHaveAttribute('data-theme', 'light');
    await create.getByLabel('项目名称', { exact: true }).fill('Coastal visual study');
    await page.screenshot({ path: 'test-results/studio-acceptance-new-project.png' });
    await create.getByRole('button', { name: '创建项目', exact: true }).click();
    const boardId = await createBoard(page, 'Coastal motion');
    await page.getByText('更多操作', { exact: true }).click();
    await page.getByRole('button', { name: '打开素材库', exact: true }).click();
    const media = page.getByRole('dialog', { name: '项目素材', exact: true });
    await expect(media).toHaveAttribute('data-theme', 'light');
    await media.getByLabel('媒体文件', { exact: true }).setInputFiles({
      name: 'shore.png',
      mimeType: 'image/png',
      buffer: reference,
    });
    await media.getByRole('button', { name: '上传并归档', exact: true }).click();
    await expect(media.getByRole('status').filter({ hasText: '媒体已完成归档' })).toBeVisible();
    await media.getByAltText('导入媒体预览').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/studio-acceptance-media-light.png' });
    await media.getByRole('button', { name: '添加到画布', exact: true }).click();
    await expect(media).not.toBeVisible();
    await page.getByText('更多操作', { exact: true }).click();
    await page.getByRole('button', { name: '工作流中心', exact: true }).click();
    const center = page.getByRole('dialog', { name: '工作流中心', exact: true });
    await center.getByText('ComfyUI 连接', { exact: true }).click();
    await center.getByLabel('连接名称', { exact: true }).fill('Acceptance GPU');
    await center.getByLabel('ComfyUI 基础地址', { exact: true }).fill(remote.baseUrl);
    await center.getByLabel('批准自部署 HTTP 或私有网络地址').check();
    await center.getByRole('button', { name: '添加连接', exact: true }).click();
    await expect(center.getByRole('status')).toContainText('已添加生成连接');
    await center.getByText('ComfyUI 连接', { exact: true }).click();
    await center.getByLabel('工作流名称', { exact: true }).fill('Coastal image to video');
    await center.getByLabel('工作流连接', { exact: true }).selectOption({ label: 'Acceptance GPU' });
    await center.getByLabel('生成方式', { exact: true }).selectOption('video.image_to_video');
    await center.getByLabel('选择 API 格式 JSON 文件', { exact: true }).setInputFiles({
      name: 'coastal-api.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixtureI2V('').graph)),
    });
    await center.getByLabel('正向文本节点', { exact: true }).fill('1');
    await center.getByLabel('首帧图片节点', { exact: true }).fill('4');
    await center.getByLabel('输出节点', { exact: true }).fill('3');
    await center.getByRole('button', { name: '验证绑定并保存', exact: true }).click();
    await expect(center.getByRole('status')).toContainText('绑定节点已验证并保存');
    await center.getByRole('button', { name: '关闭工作流中心', exact: true }).click();
    await expect(page.locator('.creative-surface img[alt="shore.png"]')).toBeVisible();
    await page.getByRole('button', { name: '以此图生成', exact: true }).click();
    const panel = page.getByRole('region', { name: '生成节点设置', exact: true });
    await panel.getByLabel('节点工作流').selectOption({ label: 'Coastal image to video · v1 · 图生视频' });
    await panel.getByLabel('生成提示词').fill('A slow camera movement along the quiet coast');
    await panel.getByRole('button', { name: '保存并生成', exact: true }).click();
    await expect(panel.getByText('候选已生成', { exact: true })).toBeVisible({ timeout: 20000 });
    await panel.getByRole('button', { name: '本节点任务', exact: true }).click();
    const video = panel.getByLabel('节点生成视频');
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
      .toBeGreaterThan(0);
    await panel.getByRole('button', { name: '加入画布结果', exact: true }).click();
    await panel.getByRole('button', { name: '存入素材库', exact: true }).click();
    await expect(panel.getByText('已存入素材库', { exact: true })).toBeVisible();
    await save(page);
    await expect(page.getByRole('button', { name: '添加 shore.png', exact: true })).toBeVisible();
    await video.evaluate((element: HTMLVideoElement) => element.play());
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0.05);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    await page.screenshot({ path: 'test-results/studio-acceptance-result.png' });
    await page.getByRole('button', { name: '深色画布', exact: true }).click();
    await page.screenshot({
      path: 'test-results/studio-acceptance-result-dark.png',
      animations: 'disabled',
    });
    await expectReadable(page.getByRole('button', { name: '媒体', exact: true }));
    await expectReadable(panel.getByRole('button', { name: '执行生成节点', exact: true }));
    await page.getByRole('button', { name: '浅色画布', exact: true }).click();
    await panel.getByRole('button', { name: '查看任务与候选', exact: true }).click();
    const tasks = page.getByRole('dialog', { name: '自由生成', exact: true });
    await expect(tasks).toHaveAttribute('data-theme', 'light');
    await expect(tasks.getByText('已存入素材库', { exact: true })).toBeVisible();
    await expect(tasks.locator('video')).toBeVisible();
    await tasks.getByRole('button', { name: '关闭', exact: true }).click();
    const first = await call('GET', `/boards/${boardId}`);
    const jobs = await call('GET', `/projects/${first.projectId}/generation-jobs`);
    expect(jobs.items).toHaveLength(1);
    const job = jobs.items[0];
    expect(job.state).toBe('completed');
    expect(job.inLibrary).toBeTruthy();
    expect(job.shotId).toBeNull();
    expect(job.boardExecution.revision).toBeLessThan(first.revision);
    await page.getByRole('button', { name: '切换 / 新建画布', exact: true }).click();
    const secondId = await createBoard(page, 'Coastal alternatives');
    await page.getByRole('button', { name: '媒体', exact: true }).click();
    await page.getByRole('button', { name: /添加 .*\.mp4/ }).click();
    await save(page);
    const second = await call('GET', `/boards/${secondId}`);
    expect(second.layout.nodes[0].data.ref.id).toBe(job.mediaVersionId);
    await page.reload();
    await expect(page.getByLabel('当前画布名称')).toHaveValue('Coastal alternatives');
    await page.getByRole('button', { name: '深色画布', exact: true }).click();
    await page.getByText('更多操作', { exact: true }).click();
    await page.getByRole('button', { name: '打开素材库', exact: true }).click();
    await expect(media).toHaveAttribute('data-theme', 'dark');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await media.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    await page.screenshot({ path: 'test-results/studio-acceptance-media-dark-mobile.png' });
    await media.getByRole('button', { name: '关闭', exact: true }).click();
    expect(remote.mock.submissions).toHaveLength(1);
    expect(
      remote.mock.uploads[0].bytes.equals(reference),
      'ComfyUI receives the exact imported artwork',
    ).toBe(true);
    expect(requests.some((path) => /\/(episodes|shots)$/.test(path))).toBeFalsy();
    expect(errors).toEqual([]);
  } finally {
    await remote.close();
  }
});
test('formal project resources, fixed versions, real media, layout, keyboard and unit entrance', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const value = await project('Harbor story');
  const unit = await call('POST', `/projects/${value.id}/units`, { kind: 'scene', title: 'Harbor morning' });
  const basic = await call('POST', `/projects/${value.id}/shots`, {
    description: 'Harbor in soft morning light.',
    unitId: unit.id,
  });
  const card = await call('GET', `/shots/${basic.id}/card/editor`);
  const shot = (
    await call('PATCH', `/shots/${basic.id}/card`, { expectedVersion: basic.version, body: card.body })
  ).shot;
  const media: Record<string, any> = {};
  for (const name of ['image.png', 'clip.mp4', 'sound.wav']) media[name] = await uploadMedia(value.id, name);
  const entities: any[] = [];
  for (const kind of ['character', 'environment', 'prop', 'voice'])
    entities.push(
      await call('POST', `/projects/${value.id}/entities`, {
        kind,
        body: {
          name: `Harbor ${kind}`,
          description: 'Stable reference.',
          attributes: kind === 'character' ? { appearance: 'Silver raincoat and short dark hair' } : {},
          media: [
            {
              role: kind === 'voice' ? 'voice_sample' : 'reference',
              mediaVersionId: media[kind === 'voice' ? 'sound.wav' : 'image.png'].id,
            },
          ],
        },
      }),
    );
  await open(page, value);
  const id = await createBoard(page, 'Harbor visual exploration');
  const historical = await call('GET', `/boards/${id}`);
  const refId = randomUUID();
  historical.layout.nodes.push({
    id: refId,
    type: 'reference',
    position: { x: 30, y: 30 },
    width: 250,
    height: 280,
    data: { ref: { kind: 'shot', id: shot.id, version: shot.version } },
  });
  await call('POST', `/boards/${id}/revisions`, {
    title: historical.title,
    expectedRevision: 1,
    layout: historical.layout,
  });
  await page.reload();
  await page.locator(`.react-flow__node[data-id="${refId}"]`).click();
  await expect(page.locator('.creative-inspector')).toContainText('Harbor in soft morning light.');
  await page.getByRole('button', { name: '查看固定版本详情', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '固定业务版本详情' })).toContainText(
    'Harbor in soft morning light.',
  );
  await expect(page.getByRole('dialog', { name: '固定业务版本详情' })).not.toContainText('sha256');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('button', { name: '资产', exact: true }).click();
  for (const kind of ['character', 'environment', 'prop', 'voice']) {
    await page.getByRole('button', { name: `添加 Harbor ${kind}`, exact: true }).click();
    if (kind === 'character') {
      await page.getByRole('button', { name: '查看固定版本详情', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '固定业务版本详情' })).toContainText(
        'Silver raincoat and short dark hair',
      );
      await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    }
  }
  const audio = page.locator('.creative-inspector audio');
  await expect(audio).toBeVisible();
  await audio.evaluate(async (element: HTMLAudioElement) => {
    await element.play();
  });
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '媒体', exact: true }).click();
  await page.getByRole('button', { name: '添加 clip.mp4', exact: true }).click();
  const video = page.locator('.creative-inspector video');
  await expect(video).toBeVisible();
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '添加 image.png', exact: true }).click();
  await expect
    .poll(() =>
      page.locator('.creative-inspector img').evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBe(96);
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  const text = page.getByRole('textbox', { name: '画布文字内容', exact: true });
  await text.fill('Keep the blue hour');
  await text.press('End');
  await text.press('Space');
  await text.pressSequentially('light');
  await text.press('ArrowLeft');
  await text.press('Delete');
  await expect(text).toHaveValue('Keep the blue hour ligh');
  await page.getByText('更多操作', { exact: true }).click();
  await page.getByRole('button', { name: '添加分组', exact: true }).click();
  await page.getByLabel('分组名称', { exact: true }).fill('Reference collection');
  await page.getByLabel('折叠分组', { exact: false }).check();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await save(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(9);
  const saved = await call('GET', `/boards/${id}`);
  expect(saved.layout.nodes).toHaveLength(9);
  expect(JSON.stringify(saved.layout)).not.toContain('Harbor character');
  expect(JSON.stringify(saved.layout)).not.toContain('LAB PRIVATE');
  expect((await call('GET', `/shots/${shot.id}/card`)).version).toBe(shot.version);
  await page.screenshot({ path: 'test-results/boards-desktop.png' });
  await page.reload();
  await expect(page.getByLabel('当前画布名称', { exact: true })).toHaveValue('Harbor visual exploration');
  const restored = await call('GET', `/boards/${id}`);
  expect(restored.layout).toEqual(saved.layout);
  const next = await call('GET', `/shots/${shot.id}/card/editor`);
  next.body.description = 'Changed description in production';
  await call('PATCH', `/shots/${shot.id}/card`, { expectedVersion: shot.version, body: next.body });
  await page.getByText('更多操作', { exact: true }).click();
  await page.getByRole('button', { name: '刷新引用', exact: true }).click();
  await expect(page.locator('.creative-surface')).toContainText('已有新版本，仍用旧引用');
  await page.getByText('更多操作', { exact: true }).click();
  await page.getByRole('button', { name: '修订历史', exact: true }).click();
  await page.getByRole('button', { name: /^v1 · Harbor visual exploration/ }).click();
  await expect(page.getByRole('dialog', { name: '查看画布修订 v1' })).toContainText('0节点 / 0连线');
  await page.getByRole('button', { name: '回到保留的草稿' }).click();
  await page.getByRole('dialog', { name: '画布修订历史' }).getByLabel('关闭对话框').click();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  const scoped = await call('POST', `/projects/${value.id}/boards`, {
    title: 'Harbor unit board',
    unitId: unit.id,
  });
  const scopedId = scoped.id;
  await page.goto(`/#canvas/${scopedId}`);
  await page.reload();
  await expect(page.getByLabel('当前画布名称')).toHaveValue('Harbor unit board');
  expect((await call('GET', `/boards/${scopedId}`)).unitId).toBe(unit.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  await page.getByLabel('画布文字内容').fill('Phone note');
  await save(page);
  await page.screenshot({ path: 'test-results/boards-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
test('two windows preserve a conflicting draft, compare, explicitly rebase, and replay a lost response', async ({
  page,
  context,
}) => {
  const value = await project('Concurrent board');
  await open(page, value);
  const id = await createBoard(page, 'Two artists');
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByLabel('当前画布名称')).toHaveValue('Two artists');
  // Delay background GETs in this tab to reproduce a stale writer reaching the server before polling.
  await second.route(`**/api/v1/boards/${id}`, (route) => route.abort());
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  await page.getByLabel('画布文字内容').fill('Server artist note');
  await save(page);
  await second.getByRole('button', { name: '添加便签', exact: true }).click();
  await second.getByLabel('画布文字内容').fill('LOCAL DRAFT MUST SURVIVE');
  await second.unroute(`**/api/v1/boards/${id}`);
  const conflict = second.waitForResponse(
    (response) => response.url().endsWith(`/boards/${id}/revisions`) && response.status() === 409,
  );
  await second.getByRole('button', { name: '保存画布', exact: true }).click();
  await conflict;
  await expect(second.getByLabel('画布文字内容')).toHaveValue('LOCAL DRAFT MUST SURVIVE');
  await expect(second.locator('.creative-conflict')).toBeVisible();
  await expectReadable(second.locator('.creative-conflict'));
  await second.screenshot({ path: 'test-results/review-board-conflict.png' });
  await second.getByRole('button', { name: '深色画布', exact: true }).click();
  await expectReadable(second.locator('.creative-conflict'));
  await second.screenshot({ path: 'test-results/review-board-conflict-dark.png' });
  await second.getByRole('button', { name: '浅色画布', exact: true }).click();
  await second.getByRole('button', { name: '比较最新修订' }).click();
  await expect(second.getByRole('dialog', { name: '查看画布修订 v2' })).toContainText('Server artist note');
  await second.getByRole('button', { name: '回到保留的草稿' }).click();
  await second.getByRole('button', { name: '保留草稿，更新基线' }).click();
  await expect(second.getByLabel('画布文字内容')).toHaveValue('LOCAL DRAFT MUST SURVIVE');
  // The server commits, then the response is lost. A retry must recover the same immutable revision.
  let dropped = false;
  await second.route(`**/api/v1/boards/${id}/revisions`, async (route) => {
    if (!dropped && route.request().method() === 'POST') {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort();
    } else await route.continue();
  });
  await second.getByRole('button', { name: '保存画布', exact: true }).click();
  await expect(second.locator('.creative-save-state')).toContainText('未保存');
  await expect(second.getByLabel('画布文字内容')).toHaveValue('LOCAL DRAFT MUST SURVIVE');
  await save(second);
  expect((await call('GET', `/boards/${id}`)).revision).toBe(3);
  await second.getByRole('button', { name: '添加便签', exact: true }).click();
  await second.getByLabel('画布文字内容').fill('Unsaved close check');
  await second.getByRole('button', { name: '返回工作台', exact: true }).click();
  await expect(second.getByRole('dialog', { name: '保留当前创作' })).toBeVisible();
  await second.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(second.getByLabel('画布文字内容')).toHaveValue('Unsaved close check');
  await second.close();
});
test('readonly board, protected voice metadata, and revoked project access', async ({ page }) => {
  const value = await project('Restricted production');
  const board = await call('POST', `/projects/${value.id}/boards`, { title: 'Read only exploration' });
  const media = await uploadMedia(value.id, 'sound.wav');
  const voice = await call('POST', `/projects/${value.id}/entities`, {
    kind: 'voice',
    body: {
      name: 'PRIVATE VOICE IDENTITY',
      description: 'Protected voice sample',
      media: [{ role: 'voice_sample', mediaVersionId: media.id }],
    },
  });
  board.layout.nodes.push({
    id: randomUUID(),
    type: 'reference',
    position: { x: 60, y: 60 },
    width: 250,
    height: 280,
    data: { ref: { kind: 'entity', id: voice.id, revisionId: voice.revision.id } },
  });
  await call('POST', `/boards/${board.id}/revisions`, {
    title: board.title,
    expectedRevision: board.revision,
    layout: board.layout,
  });
  const invite = await call('POST', `/workspaces/${setup.workspace.id}/invitations`, {
    email: 'reader@board.test',
  });
  const reader = await request.newContext({ baseURL: 'http://127.0.0.1:5192' });
  try {
    const accepted = await reader.post('/api/v1/invitations/accept', {
      data: { token: invite.token, name: 'Reader', password: 'Studio8!' },
      headers: { 'X-Studio-Request': '1' },
    });
    expect(accepted.ok()).toBeTruthy();
    const joined = await accepted.json();
    await call('POST', `/projects/${value.id}/members`, { userId: joined.user.id, role: 'VIEWER' });
    await open(page, value, reader, joined.user.id);
    await expect(page.getByLabel('当前画布名称')).toHaveValue('Read only exploration');
    await expect(page.locator('.creative-save-state')).toContainText('只读');
    await expect(page.getByRole('button', { name: '保存画布', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('当前画布名称')).toBeDisabled();
    await expect(page.getByRole('button', { name: '导入本地文件', exact: true })).toHaveCount(0);
    const transfer = await localTransfer(page, [
      { name: 'readonly.png', fixture: 'image.png', type: 'image/png' },
    ]);
    await dropFiles(page, transfer);
    expect(await pasteFiles(page, transfer)).toBeFalsy();
    await expect(page.getByRole('dialog', { name: '导入到画布', exact: true })).toHaveCount(0);
    expect((await call('GET', `/projects/${value.id}/media-uploads`)).items).toHaveLength(1);
    await expect(page.locator('.creative-surface')).toContainText('引用不可用');
    await expect(page.getByRole('main', { name: '创作画布', exact: true })).not.toContainText(
      'PRIVATE VOICE IDENTITY',
    );
    await page.screenshot({ path: 'test-results/review-board-readonly.png' });
    await call('DELETE', `/projects/${value.id}/members/${joined.user.id}`, { expectedRole: 'VIEWER' });
    // Focus revalidates access even when polling already removed the now-unauthorized controls.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('main', { name: '创作画布', exact: true })).toContainText(
      '画布或项目已不可访问',
    );
    await page.screenshot({ path: 'test-results/review-board-denied.png' });
    expect(await page.locator('.creative-surface').count()).toBe(0);
    const denied = await reader.get(`/api/v1/boards/${board.id}`);
    expect(denied.status()).toBe(404);
  } finally {
    await reader.dispose();
  }
});
test('drag, annotation connections, multi-select delete, grouping, viewport and failed media rendering', async ({
  page,
}) => {
  const value = await project('Interaction board');
  const media = await uploadMedia(value.id, 'image.png');
  await open(page, value);
  const id = await createBoard(page, 'Relations and notes');
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  await page.getByLabel('画布文字内容').fill('First note');
  await page.getByText('更多操作', { exact: true }).click();
  await page.getByRole('button', { name: '创作说明', exact: true }).click();
  await page.getByLabel('画布文字内容').fill('Second brief');
  const nodes = page.locator('.react-flow__node');
  await expect(nodes).toHaveCount(2);
  const first = nodes.filter({ hasText: 'First note' }),
    second = nodes.filter({ hasText: 'Second brief' });
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 75, box.y + 80, { steps: 8 });
  await page.mouse.up();
  const source = (await first.locator('[data-handleid="out"]').boundingBox())!,
    target = (await second.locator('.target').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(page.locator('.creative-help')).toContainText('1/200');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await save(page);
  const moved = await call('GET', `/boards/${id}`);
  expect(moved.layout.edges).toHaveLength(1);
  expect(moved.layout.nodes[0].position.y).toBeGreaterThan(0);
  await first.click();
  await page.keyboard.down('Shift');
  await second.click();
  await page.keyboard.up('Shift');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(nodes).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByText('更多操作', { exact: true }).click();
  await page.getByRole('button', { name: '添加分组', exact: true }).click();
  await page.getByLabel('分组名称').fill('Visual group');
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  await page.getByLabel('画布文字内容').fill('Grouped note');
  await page.getByText('布局设置', { exact: true }).click();
  await page.getByLabel('所属分组').selectOption({ label: 'Visual group' });
  await page.locator('.creative-group-card').click();
  await page.getByLabel('折叠分组').check();
  await expect(nodes).toHaveCount(1);
  await save(page);
  const grouped = await call('GET', `/boards/${id}`);
  expect(grouped.layout.nodes.find((node: any) => node.type === 'note').parentId).toBeTruthy();
  await page.reload();
  await expect(page.locator('.creative-group-card')).toBeVisible();
  await expect(nodes).toHaveCount(1);
  const viewport = page.locator('.react-flow__viewport');
  const transform = await viewport.getAttribute('style');
  await page.getByRole('button', { name: 'zoom in' }).click();
  await expect(viewport).not.toHaveAttribute('style', transform!);
  await save(page);
  const zoomed = await call('GET', `/boards/${id}`);
  expect(zoomed.layout.viewport.zoom).toBeGreaterThan(grouped.layout.viewport.zoom);
  await page.reload();
  await expect(viewport).toHaveAttribute('style', new RegExp(`scale\\(${zoomed.layout.viewport.zoom}`));
  await page.route(`**/api/v1/media-versions/${media.id}/content`, (route) =>
    route.fulfill({
      status: 503,
      json: { code: 'MEDIA_OBJECT_UNAVAILABLE', message: 'missing file fixture' },
    }),
  );
  await page.getByRole('button', { name: '媒体', exact: true }).click();
  await page.getByRole('button', { name: '添加 image.png', exact: true }).click();
  await expect(page.locator('.creative-inspector')).toContainText('媒体无法读取或播放');
  await save(page);
  expect(
    (await call('GET', `/boards/${id}`)).layout.nodes.find((node: any) => node.type === 'reference').data.ref
      .id,
  ).toBe(media.id);
});

test('typed canvas inputs execute one recoverable I2V job and persist one result node', async ({
  page,
  browser,
}) => {
  const remote = await startComfyMock({ 'clip.mp4': fixtures['clip.mp4'].bytes });
  try {
    const value = await project('Executable creation canvas'),
      image = await uploadMedia(value.id, 'image.png');
    const connection = await call('POST', `/projects/${value.id}/generation-connections`, {
      name: 'Node fixture',
      baseUrl: remote.baseUrl,
      trustedPrivate: true,
    });
    const workflow = await call(
      'POST',
      `/projects/${value.id}/generation-workflows`,
      fixtureI2V(connection.id),
    );
    await open(page, value);
    const id = await createBoard(page, 'Station generation');
    await page.getByRole('button', { name: '添加便签', exact: true }).click();
    await page.getByLabel('画布文字内容').fill('A quiet dolly across the station');
    await page.getByRole('button', { name: '媒体', exact: true }).click();
    await page.getByRole('button', { name: '添加 image.png', exact: true }).click();
    await page.getByRole('button', { name: '添加生成节点', exact: true }).click();
    const panel = page.getByRole('region', { name: '生成节点设置', exact: true });
    await panel.getByLabel('节点工作流').selectOption(workflow.id);
    let layout = (await call('GET', `/boards/${id}`)).layout;
    await save(page);
    layout = (await call('GET', `/boards/${id}`)).layout;
    const text = layout.nodes.find((n: any) => n.type === 'note'),
      imageNode = layout.nodes.find((n: any) => n.type === 'reference'),
      gen = layout.nodes.find((n: any) => n.type === 'generation');
    await panel.getByText('输入绑定与参数', { exact: true }).click();
    await panel.getByLabel('节点提示词输入').selectOption(text.id);
    await panel.getByLabel('节点首帧输入').selectOption(imageNode.id);
    await expect(panel.getByRole('button', { name: '保存并生成', exact: true })).toBeEnabled();
    await save(page);
    const chosen = (await call('GET', `/boards/${id}`)).layout.edges;
    expect(chosen.map((e: any) => e.kind)).toEqual(['input_binding', 'input_binding']);
    await panel.getByLabel('节点提示词输入').selectOption('');
    await page.getByRole('button', { name: '关闭节点面板', exact: true }).click();
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await page.locator(`.react-flow__node[data-id="${text.id}"] [data-handleid="text"]`).hover();
    const from = (await page
        .locator(`.react-flow__node[data-id="${text.id}"] [data-handleid="text"]`)
        .boundingBox())!,
      to = (await page
        .locator(`.react-flow__node[data-id="${gen.id}"] [data-handleid="prompt"]`)
        .boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 18 });
    await page.mouse.up();
    await page.locator(`.react-flow__node[data-id="${gen.id}"]`).click();
    await expect(panel.getByLabel('生成提示词')).toHaveValue(text.data.text);
    await save(page);
    let lost = false;
    await page.route(`**/boards/${id}/nodes/${gen.id}/generation-jobs`, async (route) => {
      if (route.request().method() === 'POST' && !lost) {
        lost = true;
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    remote.mock.mode = 'hold';
    await panel.getByRole('button', { name: '执行生成节点', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('当前画布名称')).toHaveValue('Station generation');
    await page.locator(`.react-flow__node[data-id="${gen.id}"]`).click();
    await panel.getByRole('button', { name: '执行生成节点', exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    const history = (await call('GET', `/boards/${id}/nodes/${gen.id}/generation-jobs`)).items;
    expect(history).toHaveLength(1);
    const job = history[0];
    expect(job.image.id).toBe(image.id);
    expect(job.prompt.positivePrompt).toBe(text.data.text);
    expect(job.boardExecution.bindings).toHaveLength(2);
    await page.screenshot({ path: 'test-results/review-node-running.png' });
    remote.mock.mode = 'normal';
    await expect
      .poll(async () => (await call('GET', `/generation-jobs/${job.id}`)).state, { timeout: 15000 })
      .toBe('completed');
    await panel.getByRole('button', { name: '刷新节点任务', exact: true }).click();
    await expect(panel.getByText('候选已生成', { exact: true })).toBeVisible();
    const preview = panel.getByLabel('节点生成视频');
    await expect
      .poll(() => preview.evaluate((video: HTMLVideoElement) => video.videoWidth))
      .toBeGreaterThan(0);
    await panel.getByRole('button', { name: '加入画布结果', exact: true }).click();
    await save(page);
    await expect(panel.getByRole('button', { name: '加入画布结果', exact: true })).toBeDisabled();
    await page.screenshot({ path: 'test-results/board-execution-desktop.png' });
    await page.reload();
    await expect(page.getByLabel('当前画布名称')).toHaveValue('Station generation');
    await page.locator(`.react-flow__node[data-id="${gen.id}"]`).click();
    await expect(panel.getByText('候选已生成', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '加入画布结果', exact: true })).toBeDisabled();
    const saved = await call('GET', `/boards/${id}`);
    expect(saved.layout.nodes.filter((n: any) => n.type === 'result')).toHaveLength(1);
    expect(saved.resolved[job.id].media.mediaType).toBe('video');
    expect(remote.mock.submissions).toHaveLength(1);
    await page.getByRole('button', { name: '关闭节点面板', exact: true }).click();
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await page.locator(`.react-flow__node[data-id="${job.id}"]`).click();
    await expect(page.locator('.creative-inspector video')).toBeVisible();
    await page.getByRole('button', { name: '关闭节点面板', exact: true }).click();
    await page.locator(`.react-flow__node[data-id="${gen.id}"]`).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const submit = panel.getByRole('button', { name: /^(保存并生成|执行生成节点)$/ });
    await expect(submit).toBeInViewport();
    await panel.getByText('输入绑定与参数', { exact: true }).click();
    await panel.getByLabel('节点提示词输入').scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await panel.getByText('输入绑定与参数', { exact: true }).click();
    await panel.getByRole('button', { name: '本节点任务', exact: true }).click();
    await expect(panel.getByRole('region', { name: '节点任务与候选' })).toBeFocused();
    await expect(preview).toBeInViewport();
    await page.screenshot({ path: 'test-results/board-execution-mobile.png', animations: 'disabled' });
    expect(
      await page
        .getByRole('main', { name: '创作画布', exact: true })
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBeTruthy();
    const actor = await request.newContext({ baseURL: 'http://127.0.0.1:5192' }),
      context = await browser.newContext({ baseURL: 'http://127.0.0.1:5192' });
    try {
      const invite = await call('POST', `/workspaces/${setup.workspace.id}/invitations`, {
        email: 'node-reader@board.test',
      });
      const response = await actor.post('/api/v1/invitations/accept', {
        data: { token: invite.token, name: 'Reader', password: 'Studio8!' },
        headers: { 'X-Studio-Request': '1' },
      });
      expect(response.ok()).toBeTruthy();
      const joined = await response.json();
      await call('POST', `/projects/${value.id}/members`, { userId: joined.user.id, role: 'VIEWER' });
      const readonly = await context.newPage();
      await open(readonly, value, actor, joined.user.id);
      await expect(readonly.getByLabel('当前画布名称')).toHaveValue('Station generation');
      await readonly.locator(`.react-flow__node[data-id="${gen.id}"]`).click();
      const view = readonly.getByRole('region', { name: '生成节点设置', exact: true });
      await expect(view.getByLabel('节点工作流')).toBeDisabled();
      await expect(view.getByRole('button', { name: '执行生成节点', exact: true })).toHaveCount(0);
      await expect(view.getByRole('button', { name: '加入画布结果', exact: true })).toHaveCount(0);
      await call('DELETE', `/projects/${value.id}/members/${joined.user.id}`, { expectedRole: 'VIEWER' });
      await readonly.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(readonly.getByRole('main', { name: '创作画布' }).getByRole('alert').first()).toContainText(
        /无权|不可访问/,
      );
      await expect(readonly.locator('video')).toHaveCount(0);
    } finally {
      await context.close();
      await actor.dispose();
    }
  } finally {
    await remote.close();
  }
});

test('light canvas can drag a resource, compose next to it, save and generate, then reuse the result', async ({
  page,
}) => {
  const remote = await startComfyMock({ 'clip.mp4': fixtures['clip.mp4'].bytes });
  try {
    const value = await project('Window light study');
    const image = await uploadMedia(value.id, 'image.png');
    const prompt = await call('POST', `/projects/${value.id}/prompt-library`, {
      title: 'Slow camera movement',
      positivePrompt: 'The camera slowly moves toward the station window',
      negativePrompt: 'no lettering',
      source: 'Visual studies',
    });
    const connection = await call('POST', `/projects/${value.id}/generation-connections`, {
      name: 'Canvas UX fixture',
      baseUrl: remote.baseUrl,
      trustedPrivate: true,
    });
    const fixture = fixtureI2V(connection.id);
    const workflow = await call('POST', `/projects/${value.id}/generation-workflows`, {
      ...fixture,
      graph: { ...fixture.graph, 8: { class_type: 'SeedInput', inputs: { noise_seed: 37 } } },
      parameters: [{ key: 'seed', node: '8', input: 'noise_seed', min: 0, max: 100, step: 1 }],
    });
    await open(page, value);
    const id = await createBoard(page, 'Station light');
    await expect(page.locator('.creative-theme-light')).toBeVisible();
    await page.getByRole('button', { name: '收起资源库', exact: true }).click();
    await expect(page.getByRole('complementary', { name: '正式项目资源' })).toHaveCount(0);
    await page.getByRole('button', { name: '资源库', exact: true }).click();
    await page.getByRole('button', { name: '媒体', exact: true }).click();
    await page
      .getByRole('button', { name: '添加 image.png', exact: true })
      .dragTo(page.locator('.creative-surface'), { targetPosition: { x: 320, y: 105 } });
    await expect(page.locator('.creative-surface img[alt="image.png"]')).toBeVisible();
    await page.getByRole('button', { name: '以此图生成', exact: true }).click();
    const panel = page.getByRole('region', { name: '生成节点设置' });
    await panel.getByLabel('节点工作流').selectOption(workflow.id);
    await expect(panel.locator('.creative-frame-chip')).toContainText('image.png');
    const frame = panel.getByLabel('节点首帧输入');
    const frameNode = await frame.inputValue();
    await panel.getByRole('button', { name: '移除首帧' }).click();
    await expect(panel.getByText('图生视频需要选择一张首帧。')).toBeVisible();
    await frame.selectOption(frameNode);
    await panel.getByText('输入绑定与参数', { exact: true }).click();
    await panel.getByLabel('节点Seed', { exact: true }).fill('42');
    await panel.getByText('输入绑定与参数', { exact: true }).click();
    await panel.getByLabel('生成提示词').fill('A first draft written directly on the canvas');
    await expect(panel.getByRole('button', { name: '保存并生成', exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: '应用提示词库', exact: true }).click();
    const library = panel.getByRole('region', { name: '快速选择提示词', exact: true });
    await library.getByRole('button', { name: /Slow camera movement/ }).click();
    await library.getByRole('button', { name: '应用到当前节点', exact: true }).click();
    await expect(panel.getByLabel('生成提示词')).toHaveValue(prompt.revision.positivePrompt);
    await page.screenshot({ path: 'test-results/canvas-creation-light.png' });
    const head = await call('GET', `/boards/${id}`);
    await call('POST', `/boards/${id}/revisions`, {
      title: 'Concurrent change',
      expectedRevision: head.revision,
      layout: head.layout,
    });
    await panel.getByRole('button', { name: '保存并生成', exact: true }).click();
    await expect(page.getByText(/版本冲突：草稿已保留/)).toBeVisible();
    await expect(panel.getByLabel('生成提示词')).toHaveValue(prompt.revision.positivePrompt);
    expect((await call('GET', `/projects/${value.id}/generation-jobs`)).items).toHaveLength(0);
    await page.getByRole('button', { name: '保留草稿，更新基线', exact: true }).click();
    await panel.getByRole('button', { name: '保存并生成', exact: true }).click();
    await expect(panel.getByText('候选已生成', { exact: true })).toBeVisible({ timeout: 20000 });
    const board = await call('GET', `/boards/${id}`);
    const node = board.layout.nodes.find((item: any) => item.type === 'generation');
    const source = board.layout.nodes.find((item: any) => item.type === 'reference');
    expect(source.data.ref.id).toBe(image.id);
    expect(source.position.x).toBeGreaterThan(250);
    const {
      items: [job],
    } = await call('GET', `/boards/${id}/nodes/${node.id}/generation-jobs`);
    expect(job.boardExecution.revision).toBe(board.revision);
    expect(job.promptLibrary.revisionId).toBe(prompt.revision.id);
    expect(job.image.id).toBe(image.id);
    expect(job.prompt.negativePrompt).toBe('no lettering');
    expect(job.parameterValues.seed).toBe(42);
    expect(remote.mock.submissions).toHaveLength(1);
    await panel.getByRole('button', { name: '加入画布结果', exact: true }).click();
    await panel.getByRole('button', { name: '存入素材库', exact: true }).click();
    await expect(panel.getByText('已存入素材库', { exact: true })).toBeVisible();
    await save(page);
    await page.getByRole('button', { name: '深色画布', exact: true }).click();
    await expect(page.locator('.creative-theme-dark')).toBeVisible();
    await expect(page.getByRole('button', { name: /添加 .*\.mp4/ })).toBeVisible();
    await page.screenshot({ path: 'test-results/canvas-creation-dark.png', animations: 'disabled' });
    await page.getByRole('button', { name: '切换 / 新建画布', exact: true }).click();
    const second = await createBoard(page, 'Alternate edit');
    await page.getByRole('button', { name: '媒体', exact: true }).click();
    await page.getByRole('button', { name: /添加 .*\.mp4/ }).click();
    await save(page);
    const alternate = await call('GET', `/boards/${second}`);
    expect(alternate.layout.nodes[0].data.ref.id).toBe(job.mediaVersionId);
  } finally {
    await remote.close();
  }
});

test('three canvases share project assets and an I2V result without shots or compiler', async ({ page }) => {
  const remote = await startComfyMock({ 'clip.mp4': fixtures['clip.mp4'].bytes });
  try {
    const value = await project('Shared asset canvases'),
      image = await uploadMedia(value.id, 'image.png');
    const entity = await call('POST', `/projects/${value.id}/entities`, {
      kind: 'character',
      body: {
        name: 'Traveler',
        description: 'A traveler',
        attributes: {},
        media: [{ role: 'reference', mediaVersionId: image.id }],
      },
    });
    const connection = await call('POST', `/projects/${value.id}/generation-connections`, {
      name: 'Canvas fixture',
      baseUrl: remote.baseUrl,
      trustedPrivate: true,
    });
    const workflow = await call(
      'POST',
      `/projects/${value.id}/generation-workflows`,
      fixtureI2V(connection.id),
    );
    await open(page, value);
    const a = await createBoard(page, 'Character study');
    await page.getByRole('button', { name: '资产', exact: true }).click();
    await page.getByRole('button', { name: '添加 Traveler', exact: true }).click();
    await save(page);
    await page.getByRole('button', { name: '自由生成', exact: true }).click();
    const generation = page.getByRole('dialog', { name: '自由生成', exact: true });
    await generation.getByLabel('生成工作流', { exact: true }).selectOption(workflow.id);
    await generation.getByLabel('首帧图片', { exact: true }).selectOption(image.id);
    await generation.getByLabel('正向提示词', { exact: true }).fill('The traveler walks along the platform');
    remote.mock.mode = 'hold';
    await generation.getByRole('button', { name: '加入生成队列', exact: true }).click();
    await expect(generation.getByRole('status')).toContainText('生成任务已加入队列');
    await generation.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    const job = (await call('GET', `/projects/${value.id}/generation-jobs`)).items[0];
    expect(job.shotId).toBeNull();
    expect(job.boardId).toBe(a);
    expect(job.promptId).toBeNull();
    remote.mock.mode = 'normal';
    await expect
      .poll(async () => (await call('GET', `/generation-jobs/${job.id}`)).state, { timeout: 15000 })
      .toBe('completed');
    await page.getByRole('button', { name: `打开项目 ${value.title}`, exact: true }).click();
    await expect(page.getByLabel('当前画布名称')).toHaveValue('Character study');
    await page.getByRole('button', { name: '自由生成', exact: true }).click();
    await generation.getByRole('button', { name: '存入素材库', exact: true }).click();
    await expect(generation.getByText('已存入素材库', { exact: true })).toBeVisible();
    await generation.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '切换 / 新建画布', exact: true }).click();
    const b = await createBoard(page, 'Scene study');
    await page.getByRole('button', { name: '资产', exact: true }).click();
    await page.getByRole('button', { name: '添加 Traveler', exact: true }).click();
    await page.getByRole('button', { name: '媒体', exact: true }).click();
    await page.getByRole('button', { name: '添加 clip.mp4', exact: true }).click();
    await page.getByRole('button', { name: '切换 / 新建画布', exact: true }).click();
    const warning = page.getByRole('dialog', { name: '保留当前创作', exact: true });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(page.getByLabel('当前画布名称')).toHaveValue('Scene study');
    await save(page);
    await page.getByRole('button', { name: '切换 / 新建画布', exact: true }).click();
    const c = await createBoard(page, 'Video study');
    await page.getByRole('button', { name: '资产', exact: true }).click();
    await page.getByRole('button', { name: '添加 Traveler', exact: true }).click();
    await save(page);
    await page.reload();
    await expect(page.getByLabel('当前画布名称')).toHaveValue('Video study');
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await page.goto('/');
    await page.getByRole('button', { name: `打开项目 ${value.title}`, exact: true }).click();
    await expect(page.getByLabel('当前画布名称')).toHaveValue('Video study');
    const boards = await Promise.all([a, b, c].map((id) => call('GET', `/boards/${id}`)));
    for (const board of boards)
      expect(board.layout.nodes.find((node: any) => node.data.ref?.kind === 'entity').data.ref.id).toBe(
        entity.id,
      );
    expect(boards[0].layout.nodes).toHaveLength(1);
    expect(boards[1].layout.nodes).toHaveLength(2);
    expect(boards[2].layout.nodes).toHaveLength(1);
    expect(remote.mock.submissions).toHaveLength(1);
    expect(remote.mock.uploads[0].bytes).toEqual(fixtures['image.png'].bytes);
  } finally {
    await remote.close();
  }
});
