import type { Node } from '@xyflow/react';
import type { BoardNode, BoardResolved } from '../../../../packages/contracts/src/board';
export type CanvasNode = Node<
  { domain: BoardNode; value?: BoardResolved; hasReferenceInputs?: boolean; childCount?: number },
  'boardNode'
>;
export const statusLabels: Record<BoardResolved['status'], string> = {
  current: '当前固定版本',
  stale: '已有新版本，仍用旧引用',
  draft: '草稿，尚未批准',
  revoked: '引用版本已撤销批准',
  unavailable: '引用不可用',
};
export const kindLabels: Record<string, string> = {
  shot: '镜头',
  character: '角色',
  environment: '场景',
  prop: '道具',
  voice: '声音资产',
  image: '图片',
  video: '视频',
  audio: '音频',
  note: '文本便签',
  brief: '创作说明',
  group: '分组',
  generation: '生成节点',
  result: '生成结果',
};
