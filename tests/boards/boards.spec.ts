import { test, expect, request, APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createMediaFixtures } from '../fixtures/media-fixtures.mjs';
import { startComfyMock, fixtureI2V, fixtureWorkflow } from '../fixtures/comfy-mock.mjs';
let owner: APIRequestContext, setup: any, fixtures: any;
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
  await expect(page.getByRole('dialog', { name: '创作画布', exact: true })).toBeVisible();
}
async function createBoard(page: Page, title: string) {
  await page.getByRole('textbox', { name: '画布名称', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建画布', exact: true }).click();
  await expect(page.getByLabel('当前画布名称', { exact: true })).toHaveValue(title);
  return (await page.url()).split('#canvas/')[1];
}
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
}) => {
  const remote = await startComfyMock({ 'clip.mp4': fixtures['clip.mp4'].bytes });
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
      buffer: fixtures['image.png'].bytes,
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
    await page.screenshot({ path: 'test-results/studio-acceptance-result.png' });
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
    expect(remote.mock.uploads[0].bytes).toEqual(fixtures['image.png'].bytes);
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
    await expect(page.getByRole('dialog', { name: '创作画布', exact: true })).not.toContainText(
      'PRIVATE VOICE IDENTITY',
    );
    await call('DELETE', `/projects/${value.id}/members/${joined.user.id}`, { expectedRole: 'VIEWER' });
    await page.getByText('更多操作', { exact: true }).click();
    await page.getByRole('button', { name: '刷新引用', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '创作画布', exact: true })).toContainText(
      '画布或项目已不可访问',
    );
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
        .getByRole('dialog', { name: '创作画布', exact: true })
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
      await view.getByRole('button', { name: '刷新节点任务', exact: true }).click();
      await expect(view.getByRole('alert')).toBeVisible();
      await expect(view.locator('video')).toHaveCount(0);
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
    page.once('dialog', (dialog) => dialog.accept());
    const library = page.getByRole('dialog', { name: '项目提示词库', exact: true });
    await library.getByRole('button', { name: /Slow camera movement/ }).click();
    await library.getByRole('button', { name: '应用此版本', exact: true }).click();
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
