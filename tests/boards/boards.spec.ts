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
  await page.getByRole('button', { name: '创作画布', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '创作画布', exact: true })).toBeVisible();
}
async function createBoard(page: Page, title: string) {
  await page.getByRole('textbox', { name: '画布名称', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建画布', exact: true }).click();
  await expect(page.getByLabel('当前画布名称', { exact: true })).toHaveValue(title);
  return (await page.url()).split('#canvas/')[1];
}
async function save(page: Page) {
  await page.getByRole('button', { name: '保存画布', exact: true }).click();
  await expect(page.locator('.creative-save-state')).toContainText('已保存');
}
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
  await page.getByRole('button', { name: '添加分组', exact: true }).click();
  await page.getByLabel('分组名称', { exact: true }).fill('Reference collection');
  await page.getByLabel('折叠分组', { exact: false }).check();
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
  await page.getByRole('button', { name: '刷新引用', exact: true }).click();
  await expect(page.locator('.creative-surface')).toContainText('已有新版本，仍用旧引用');
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
    await page.getByRole('button', { name: /Read only exploration/ }).click();
    await expect(page.locator('.creative-save-state')).toContainText('只读');
    await expect(page.getByRole('button', { name: '保存画布', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('当前画布名称')).toBeDisabled();
    await expect(page.locator('.creative-surface')).toContainText('引用不可用');
    await expect(page.getByRole('dialog', { name: '创作画布', exact: true })).not.toContainText(
      'PRIVATE VOICE IDENTITY',
    );
    await call('DELETE', `/projects/${value.id}/members/${joined.user.id}`, { expectedRole: 'VIEWER' });
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
  const source = (await first.locator('.source').boundingBox())!,
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
  await page.getByRole('button', { name: '添加分组', exact: true }).click();
  await page.getByLabel('分组名称').fill('Visual group');
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  await page.getByLabel('画布文字内容').fill('Grouped note');
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
    await page.getByRole('button', { name: '创作画布', exact: true }).click();
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
