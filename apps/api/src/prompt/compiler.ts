import { FormalCard } from '../production/formal-card';
import { PromptConfig } from './prompt-contract';
export const compilerVersion = 'neutral-text-1';
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
export function compilePrompt(card: FormalCard, project: CompileProject, config: PromptConfig) {
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
    ['正向约束', config.positiveRules.join('；')],
    ['避开以下内容', config.negativeMode === 'inline' ? config.negativeRules.join('；') : ''],
    ['提示词后置说明', config.suffix],
  ].filter(([, value]) => value.trim());
  const warnings: string[] = ['手工文本交付；尚未选择或验证媒体模型能力，不代表可直接执行生成。'];
  if (!card.description.trim()) warnings.push('画面描述为空，请完善制作卡。');
  if (!card.sourceSpanIds.length) warnings.push('此卡未关联原文证据，为手动创作内容。');
  if (card.assets.length) warnings.push('资产仅为名称，尚无固定版本的媒体参考绑定。');
  if (config.negativeMode === 'inline' && config.negativeRules.length)
    warnings.push('按此 Profile 将禁止项写入正向提示词；目标模型效果尚未验证。');
  warnings.push(...card.riskNotes.map((value) => `待核对：${value}`));
  return {
    positivePrompt: sections.map(([label, value]) => `${label}：${value}`).join('\n\n'),
    negativePrompt: config.negativeMode === 'separate' ? config.negativeRules.join('；') : '',
    structuredSegments: Object.fromEntries(sections),
    inputBindings: [],
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
