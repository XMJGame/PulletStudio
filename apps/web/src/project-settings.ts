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
