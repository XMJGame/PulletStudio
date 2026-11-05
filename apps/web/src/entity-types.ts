export const entityLabels = { character: '人物', environment: '场景', prop: '道具', voice: '声音角色' };
export type EntityKind = keyof typeof entityLabels;
export const roleLabels: Record<string, string> = {
  front: '正面主锚点',
  side: '侧面',
  back: '背面',
  closeup: '面部特写',
  overview: '全景',
  floorplan: '平面布局',
  detail: '细节',
  reference: '其他参考',
  voice_sample: '声音样本',
};
export const attributeLabels: Record<EntityKind, Record<string, string>> = {
  character: {
    appearance: '外观设定',
    costume: '服装设定',
    state: '当前状态',
    continuityNotes: '连续性说明',
  },
  environment: { layout: '空间布局', lighting: '光线设定', state: '当前状态', continuityNotes: '连续性说明' },
  prop: {
    appearance: '形体设定',
    scale: '尺度',
    material: '材质',
    state: '当前状态',
    continuityNotes: '连续性说明',
  },
  voice: { language: '语言', timbre: '音色描述', usageRights: '授权与使用范围' },
};
export type EntityReference = { revisionId: string; purpose: string };
export type EntityRevision = {
  id: string;
  entityId: string;
  kind: EntityKind;
  version: number;
  name: string;
  description: string;
  attributes: Record<string, string>;
  status: 'draft';
  media: { role: string; mediaVersionId: string; version: number; fileName: string; mediaType: string }[];
  purpose?: string;
};
export type Entity = {
  id: string;
  kind: EntityKind;
  projectId: string;
  currentVersion: number;
  revision: EntityRevision;
  canEdit: boolean;
};
