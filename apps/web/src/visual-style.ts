export const visualStyles = [
  { value: 'unspecified', label: '暂不设定' },
  { value: 'cinematic_realism', label: '写实电影' },
  { value: 'animation_3d', label: '3D 动画' },
  { value: 'animation_2d', label: '2D 动画' },
  { value: 'ink_wash', label: '水墨国风' },
  { value: 'custom', label: '自定义' },
] as const;
export type VisualStyle = (typeof visualStyles)[number]['value'];
export const visualStyleLabel = (value: VisualStyle) =>
  visualStyles.find((item) => item.value === value)?.label || '暂不设定';
