export const formatLabels: Record<string, string> = {
  custom: '自定义 / 暂不设定',
  short: '短片',
  longform: '长视频',
  series: '连续剧 / 系列',
  film: '电影',
  ad: '广告',
  mv: '音乐影像',
  documentary: '纪录片',
};
export const narrativeLabels: Record<string, string> = {
  none: '无特定叙事方式',
  narration: '旁白',
  dialogue: '对白演绎',
  hybrid: '旁白与对白',
  music_driven: '音乐驱动',
};
export const unitLabels: Record<string, string> = {
  episode: '分集',
  act: '幕',
  chapter: '章节',
  sequence: '段落组',
  scene: '场次',
  section: '段落',
};
export const techniqueLabels: Record<string, string> = {
  unspecified: '暂不设定',
  static: '静态画面',
  animated_still: '静帧动效',
  text_to_video: '文生视频',
  image_to_video: '图生视频',
  video_edit: '视频编辑',
  external: '外部工具制作',
};
export function projectFormData(input: Record<string, unknown>) {
  return {
    ...input,
    targetDurationSeconds: input.targetDurationSeconds === '' ? null : Number(input.targetDurationSeconds),
  };
}
export type SettingsImpact = {
  changedFields: string[];
  units: number;
  shots: number;
  scripts: number;
  requiresConfirmation: boolean;
  warnings: string[];
};
