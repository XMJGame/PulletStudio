import { ExportDocument } from './export-contract';

export const exportMediaTypes = {
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};
export function csvCell(value: unknown) {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/^[\s\p{Cc}\p{Cf}]*[=+\-@]|^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function heading(text: string) {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|]/g, '\\$&');
}
function block(text: string) {
  let length = 3;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}text\n${text}\n${fence}`;
}
export function renderStoryboard(document: ExportDocument, format: 'json' | 'md' | 'csv'): Buffer {
  if (format === 'json') return Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
  if (format === 'md') {
    const parts = [
      `# ${heading(document.project.title)} · 分镜文档`,
      `项目 ${document.project.code} · v${document.project.version} · ${document.shots.length} 个镜头`,
      block(
        `schemaVersion: ${document.schemaVersion}\nexportId: ${document.exportId}\nexportedAt: ${document.exportedAt}\nsnapshotHash: ${document.snapshotHash}`,
      ),
      '## 项目设定',
      block(JSON.stringify(document.project, null, 2)),
      '## 导出说明',
      block(document.warnings.join('\n')),
    ];
    for (const shot of document.shots) {
      const path = shot.unitPath.map((unit) => `${unit.code} ${unit.title}`).join(' / ') || '项目直属';
      parts.push(
        `## ${heading(path)} / ${shot.code}`,
        block(
          `shotId: ${shot.id}\nShot版本: ${shot.version}\n制作卡版本: ${shot.card?.version ?? '缺失'}\n排序: ${shot.sequence}`,
        ),
      );
      if (shot.warnings.length) parts.push('### 警告', block(shot.warnings.join('\n')));
      parts.push(
        '### 完整制作卡',
        block(JSON.stringify(shot.card?.body ?? shot.basic, null, 2)),
        '### 原文引用',
        block(JSON.stringify(shot.card?.sources ?? [], null, 2)),
        '### 固定资产引用',
        block(JSON.stringify(shot.card?.assetReferences ?? [], null, 2)),
      );
      if (shot.prompt)
        parts.push(
          '### 提示词来源',
          block(
            JSON.stringify(
              { kind: shot.prompt.kind, artifactId: shot.prompt.id, freshness: shot.prompt.freshness },
              null,
              2,
            ),
          ),
          '### 完整正向提示词',
          block(shot.prompt.rendered.positivePrompt),
          '### 完整负面提示词',
          block(shot.prompt.rendered.negativePrompt),
          '### 提示词固定输入与输出元数据',
          block(JSON.stringify(shot.prompt, null, 2)),
          '### 提示词警告',
          block(shot.prompt.rendered.warnings.join('\n')),
        );
      else parts.push('### 提示词', '未提供提示词，未自动创建已保存记录。');
    }
    parts.push('## 固定制作层级', block(JSON.stringify(document.units, null, 2)));
    return Buffer.from(parts.join('\n\n') + '\n', 'utf8');
  }
  const headers = [
    'export_id',
    'exported_at',
    'snapshot_hash',
    'project_code',
    'project_title',
    'project_version',
    'unit_path',
    'unit_path_json',
    'shot_code',
    'shot_id',
    'sequence',
    'shot_version',
    'card_version',
    'title',
    'intent',
    'description',
    'framing',
    'angle',
    'composition',
    'camera_movement',
    'action',
    'lighting',
    'mood',
    'dialogue',
    'audio_notes',
    'duration_seconds',
    'technique',
    'source_audio_policy',
    'assets',
    'risk_notes',
    'positive_prompt',
    'negative_prompt',
    'prompt_id',
    'prompt_origin',
    'prompt_stale',
    'warnings',
    'card_json',
    'sources_json',
    'prompt_json',
    'project_json',
    'asset_references_json',
    'asset_warnings_json',
  ];
  const rows = document.shots.map((shot) => {
    const card = shot.card?.body;
    return [
      document.exportId,
      document.exportedAt,
      document.snapshotHash,
      document.project.code,
      document.project.title,
      document.project.version,
      shot.unitPath.map((unit) => `${unit.code} ${unit.title}`).join(' / ') || '项目直属',
      shot.unitPath.map((unit) => document.units.find((item) => item.id === unit.id)),
      shot.code,
      shot.id,
      shot.sequence,
      shot.version,
      shot.card?.version,
      card?.title,
      card?.intent,
      card?.description ?? shot.basic.description,
      card?.framing,
      card?.angle,
      card?.composition,
      card?.cameraMovement ?? shot.basic.camera,
      card?.action,
      card?.lighting,
      card?.mood,
      card?.dialogue ?? shot.basic.dialogue,
      card?.audioNotes,
      card?.durationSeconds ?? shot.basic.durationHint,
      card?.technique ?? shot.basic.technique,
      card?.sourceAudioPolicy,
      card?.assets,
      card?.riskNotes,
      shot.prompt?.rendered.positivePrompt,
      shot.prompt?.rendered.negativePrompt,
      shot.prompt?.id,
      shot.prompt?.kind,
      shot.prompt?.freshness.stale,
      [...document.warnings, ...shot.warnings, ...(shot.prompt?.rendered.warnings ?? [])],
      card ?? shot.basic,
      shot.card?.sources ?? [],
      shot.prompt ?? null,
      document.project,
      shot.card?.assetReferences ?? [],
      shot.card?.assetWarnings ?? [],
    ];
  });
  return Buffer.from(
    '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
    'utf8',
  );
}
