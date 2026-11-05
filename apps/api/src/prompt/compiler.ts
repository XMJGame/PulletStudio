import { FormalCard } from '../production/formal-card';
import { PromptConfig } from './prompt-contract';
import { EntitySnapshot } from '../assets/entity-references';
export const compilerVersion = 'neutral-text-3';
const approvalLabels = { draft: '草稿', approved: '已批准', revoked: '已撤销批准' };
export type CompileProject = {
  title: string;
  aspectRatio: string;
  language: string;
  stylePreset: string;
  styleDescription: string;
  directorNotes: string;
  workFormat: string;
  narrativeMode: string;
};
const styles: Record<string, string> = {
  unspecified: '',
  cinematic_realism: '写实电影',
  animation_3d: '3D 动画',
  animation_2d: '2D 动画',
  ink_wash: '水墨国风',
  custom: '自定义风格',
};
const policies: Record<string, string> = {
  keep: '保留原声',
  mute: '静音原声',
  inspect: '先检查原声再决定',
  replace: '替换原声',
};
const entityLabels: Record<string, string> = {
  character: '人物',
  environment: '场景',
  prop: '道具',
  voice: '声音角色',
};
const attributeLabels: Record<string, string> = {
  appearance: '外观',
  costume: '服装',
  state: '状态',
  continuityNotes: '连续性说明',
  layout: '布局',
  lighting: '光线',
  scale: '尺度',
  material: '材质',
  language: '语言',
  timbre: '音色',
};
export function compilePrompt(
  card: FormalCard,
  project: CompileProject,
  config: PromptConfig,
  references: (EntitySnapshot & { purpose: string })[] = [],
) {
  const sections = [
    ['提示词前置说明', config.prefix],
    ['镜头', card.title],
    ['创作意图', card.intent],
    ['画面', card.description],
    ['景别', card.framing],
    ['视角', card.angle],
    ['构图', card.composition],
    ['运镜', card.cameraMovement],
    ['动作', card.action],
    ['光线', card.lighting],
    ['情绪', card.mood],
    [
      '视觉风格',
      [
        styles[project.stylePreset] || (project.stylePreset === 'unspecified' ? '' : project.stylePreset),
        project.styleDescription,
      ]
        .filter(Boolean)
        .join('；'),
    ],
    ['导演要求', project.directorNotes],
    ['画幅', project.aspectRatio],
    ['语言', project.language],
    ['计划时长', `${card.durationSeconds} 秒（待实际媒体与声音核对）`],
    ['对白 / 旁白', card.dialogue],
    ['声音说明', card.audioNotes],
    ['原声处理计划', policies[card.sourceAudioPolicy]],
    ['待落实资产名称', card.assets.join('；')],
    [
      '固定资产设定',
      references
        .map(
          (ref) =>
            `${ref.name}（${entityLabels[ref.kind]}，v${ref.version}）${ref.purpose ? '；用途：' + ref.purpose : ''}\n${ref.description}\n${Object.entries(
              ref.attributes,
            )
              .filter(([key, value]) => Boolean(value) && !['usageRights', 'consentStatus'].includes(key))
              .map(([key, value]) => `${attributeLabels[key] ?? key}：${value}`)
              .join('；')}`,
        )
        .join('\n\n'),
    ],
    ['正向约束', config.positiveRules.join('；')],
    ['避开以下内容', config.negativeMode === 'inline' ? config.negativeRules.join('；') : ''],
    ['提示词后置说明', config.suffix],
  ].filter(([, value]) => value.trim());
  const warnings: string[] = ['手工文本交付；尚未选择或验证媒体模型能力，不代表可直接执行生成。'];
  if (!card.description.trim()) warnings.push('画面描述为空，请完善制作卡。');
  if (!card.sourceSpanIds.length) warnings.push('此卡未关联原文证据，为手动创作内容。');
  if (card.assets.length)
    warnings.push(
      references.length
        ? '文字资产名称仅为备忘，请与固定引用逐项核对。'
        : '资产仅为名称，尚无固定版本的媒体参考绑定。',
    );
  for (const ref of references) {
    if (ref.status !== 'approved')
      warnings.push(`资产「${ref.name}」v${ref.version}状态为${approvalLabels[ref.status]}，需要有效批准。`);
    if (!ref.media.length) warnings.push(`资产「${ref.name}」没有固定媒体参考。`);
    if (ref.kind === 'character' && !ref.media.some((media) => media.role === 'front'))
      warnings.push(`人物「${ref.name}」缺少正面主锚点。`);
    if (ref.kind === 'environment' && !ref.media.some((media) => media.role === 'overview'))
      warnings.push(`场景「${ref.name}」缺少全景参考。`);
    if (
      ref.kind === 'voice' &&
      (ref.attributes.consentStatus === 'unknown' || !ref.attributes.usageRights?.trim())
    )
      warnings.push(`声音「${ref.name}」的授权/同意尚待核对；不得用于外部生成。`);
  }
  if (config.negativeMode === 'inline' && config.negativeRules.length)
    warnings.push('按此 Profile 将禁止项写入正向提示词；目标模型效果尚未验证。');
  warnings.push(...card.riskNotes.map((value) => `待核对：${value}`));
  return {
    positivePrompt: sections.map(([label, value]) => `${label}：${value}`).join('\n\n'),
    negativePrompt: config.negativeMode === 'separate' ? config.negativeRules.join('；') : '',
    structuredSegments: Object.fromEntries(sections),
    inputBindings: references.flatMap((ref) =>
      ref.media.map((media) => ({
        entityId: ref.entityId,
        entityRevisionId: ref.id,
        kind: ref.kind,
        role: media.role,
        mediaVersionId: media.mediaVersionId,
        mediaVersion: media.version,
        purpose: ref.purpose,
      })),
    ),
    audioPolicy: {
      source: card.sourceAudioPolicy,
      notes: card.audioNotes,
      dialogue: card.dialogue,
      applied: false,
    },
    warnings,
    delivery: 'manual',
    productionReady: false,
    compilerVersion,
  };
}
