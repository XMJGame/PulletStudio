export type CreationTarget = 'image' | 'video' | 'audio';
export type CanvasCreation = 'brief' | 'note' | 'group' | CreationTarget;

export const creationActions = [
  { kind: 'brief', label: '文字节点', title: '文本', icon: 'text' },
  { kind: 'image', label: '图片节点', title: '图片', icon: 'image' },
  { kind: 'video', label: '视频节点', title: '视频', icon: 'film' },
  { kind: 'audio', label: '音频节点', title: '音频', icon: 'audio' },
  { kind: 'note', label: '便签节点', title: '便签', icon: 'note' },
  { kind: 'group', label: '分组', title: '分组', icon: 'layers' },
] as const;

export function isCreationTarget(kind: CanvasCreation): kind is CreationTarget {
  return kind === 'image' || kind === 'video' || kind === 'audio';
}
