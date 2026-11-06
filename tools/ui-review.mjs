import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const destination = new URL('docs/review/studio-ui-v2/', root);
// Explicit allowlist: only rendered PNGs from isolated, formal API acceptance tests.
// Never collect test databases, media roots, traces, browser profiles or environment files.
const captures = [
  ['项目首页 · 浅色桌面', 'review-project-light-1440.png', 'project.png'],
  ['项目首页 · 深色手机', 'review-project-dark-390.png', 'project-mobile.png'],
  ['正式创作与候选归档', 'studio-acceptance-result.png', 'canvas.png'],
  ['正式创作与候选归档 · 深色', 'studio-acceptance-result-dark.png', 'canvas-dark.png'],
  ['素材上传', 'studio-acceptance-media-light.png', 'media.png'],
  ['提示词管理', 'review-prompts-light-1440.png', 'prompts.png'],
  ['工作流中心', 'review-workflows-light-1440.png', 'workflows.png'],
  ['候选对照', 'candidates-compare-desktop.png', 'candidates.png'],
  ['只读资源预览', 'source-preview-readonly-mobile.png', 'resource-mobile.png'],
  ['工作流中心 · 深色实际 150% 缩放', 'review-workflows-dark-zoom-150.png', 'workflow-zoom.png'],
  ['画布冲突与草稿', 'review-board-conflict.png', 'conflict.png'],
  ['提示词冲突与草稿', 'review-prompt-conflict.png', 'prompt-conflict.png'],
  ['无效工作流与输入保留', 'review-workflow-invalid.png', 'workflow-error.png'],
  ['生成中 · Mock 远端', 'review-node-running.png', 'running.png'],
  ['项目撤权', 'review-board-denied.png', 'denied.png'],
  ['上传失败与恢复', 'direct-import-mobile.png', 'upload-error.png'],
];
const verified = await Promise.all(
  captures.map(async ([label, source, file]) => {
    const path = new URL(`test-results/${source}`, root);
    const bytes = await readFile(path);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error(`Not a PNG capture: ${source}`);
    return {
      label,
      source: `test-results/${source}`,
      file,
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      bytes: bytes.length,
      path,
    };
  }),
);
if (verified.reduce((total, capture) => total + capture.bytes, 0) > 5 * 1024 * 1024)
  throw new Error('Review screenshots exceed the 5 MiB evidence budget');
await mkdir(destination, { recursive: true });
for (const capture of verified) await copyFile(capture.path, new URL(capture.file, destination));
await writeFile(
  new URL('captures.json', destination),
  JSON.stringify(
    {
      scope: 'Formal Web + API views; isolated test data, original synthetic artwork and Mock ComfyUI',
      captures: verified.map(({ path, ...capture }) => capture),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Collected ${verified.length} formal UI screenshots (${Math.round(verified.reduce((n, c) => n + c.bytes, 0) / 1024)} KiB).`,
);
