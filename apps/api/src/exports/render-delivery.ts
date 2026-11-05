import { createHash } from 'node:crypto';
import { PackageSnapshot } from './media-package-contract';
import { csvCell } from './render-storyboard';

export function deliveryMediaPath(mime: string, code: string, takeNo: number, extension: string) {
  const directory = mime.startsWith('video/')
    ? '01_Video'
    : mime.startsWith('audio/')
      ? '02_Audio'
      : '03_Images';
  const safeCode = code.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'Shot';
  return `${directory}/${safeCode}_Take${String(takeNo).padStart(2, '0')}.${extension}`;
}

function block(text: string) {
  let length = 3;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `${fence}text\n${text}\n${fence}`;
}

export function deliveryDocuments(snapshot: PackageSnapshot): NonNullable<PackageSnapshot['documents']> {
  const headers = [
    'order',
    'unit_path',
    'shot_code',
    'shot_id',
    'shot_version',
    'card_version',
    'take_no',
    'take_id',
    'media_path',
    'original_file_name',
    'media_version_id',
    'media_type',
    'mime',
    'byte_length',
    'planned_duration_seconds',
    'source_duration_ms',
    'source_frame_rate',
    'width',
    'height',
    'has_source_audio',
    'source_audio_policy',
    'description',
    'dialogue',
    'audio_notes',
    'approval_id',
    'approval_version',
    'approved_by',
    'approved_at',
    'selection_id',
    'selection_version',
    'generation_job_id',
    'workflow_id',
    'asset_revisions_json',
  ];
  const rows = snapshot.shots.map((shot, index) => {
    const file = snapshot.files.find((file) => file.mediaVersionId === shot.take.mediaVersionId)!;
    const card = shot.card?.body;
    return [
      index + 1,
      shot.unitPath.map((unit) => `${unit.code} ${unit.title}`).join(' / '),
      shot.code,
      shot.id,
      shot.version,
      shot.card?.version,
      shot.take.takeNo,
      shot.take.id,
      file.path,
      file.fileName,
      file.mediaVersionId,
      file.mime.split('/')[0],
      file.mime,
      file.byteLength,
      card?.durationSeconds,
      file.metadata.durationMs,
      file.metadata.frameRate,
      file.metadata.width,
      file.metadata.height,
      file.metadata.hasAudio,
      card?.sourceAudioPolicy,
      card?.description,
      card?.dialogue,
      card?.audioNotes,
      shot.approval.id,
      shot.approval.version,
      shot.approval.actorName,
      shot.approval.createdAt,
      shot.selection.id,
      shot.selection.version,
      shot.source?.jobId,
      shot.source?.workflow.id,
      (shot.card?.assetReferences ?? []).map((asset) => ({
        entityId: asset.entityId,
        revisionId: asset.id,
        version: asset.version,
      })),
    ];
  });
  const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const notes =
    [
      '# Pullet Studio 后期交付说明',
      block(
        `${snapshot.project.title}\n项目：${snapshot.project.code} · v${snapshot.project.version}\n画幅：${snapshot.project.aspectRatio}\n语言：${snapshot.project.language}`,
      ),
      '## 包内内容',
      `${snapshot.shots.length} 个已选镜头，${snapshot.files.length} 个去重原件。ShotList.csv 的 order 是本次交付顺序；media_path 是相对 ZIP 根的实际文件路径。多个镜头可以引用同一原件，勿按文件数量推断镜头数量。`,
      '视频位于 01_Video，音频位于 02_Audio，图片位于 03_Images，仅存在对应原件时出现目录。音频尚未按旁白/对白/音乐/音效分类，不按文件名猜测用途。',
      '## 时长与原声',
      'planned_duration_seconds 是制作卡计划；source_duration_ms / source_frame_rate 是原件探测值。二者不等于最终剪辑时长，不自动生成剪辑入出点或时间码。source_audio_policy 是制作意图，交付始终保留原件字节，keep/mute/inspect/replace 不在此包修改原声。inspect/replace 应由后期明确核对。',
      '## 版本与审核',
      'manifest.json 固定本次选片、Take、制作卡、批准依据、媒体元数据及可用的生成来源。批准表示创建交付清单时的审核决定，之后撤销或改片不会重写本历史包。文件 SHA256 及字节数用于完整性校验；两份文档的 UTF-8 正文也在 manifest.documents 中冻结。',
      '## 范围与交接',
      '本包只包含所选 Take 原件及两份交付文档。制作卡中的参考资产保留固定版本引用，未选参考原件不自动打包；独立旁白/配乐/音效附件、字幕 SRT 和 PDF 尚未纳入本包。没有从对白文字推断字幕时间码，也没有生成空占位文件。',
      '这是标准媒体交接包，不是完整项目备份或专业剪辑工程。请在外部剪辑软件导入原件，按 ShotList/制作说明编排；OTIO/FCPXML 与具体软件兼容性尚未验收。',
      '## 项目制作说明',
      block(snapshot.project.directorNotes || '未填写项目导演说明。'),
    ].join('\n\n') + '\n';
  return [
    { path: '05_Documents/ShotList.csv', mime: 'text/csv' as const, content: csv },
    { path: '05_Documents/ProductionNotes.md', mime: 'text/markdown' as const, content: notes },
  ].map((document) => ({
    ...document,
    encoding: 'utf-8',
    byteLength: Buffer.byteLength(document.content),
    sha256: createHash('sha256').update(document.content).digest('hex'),
  }));
}
