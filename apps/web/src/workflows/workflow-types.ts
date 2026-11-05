import type { AvailableParameter } from '../components/GenerationParameters';
export type Workflow = {
  id: string;
  name: string;
  capability: string;
  enabled: boolean;
  createdAt: string;
  parameters: AvailableParameter[];
};
export type Connection = { id: string; name: string; version: number; enabled: boolean };
export type GenerationConfig = {
  canConfigure: boolean;
  canEdit: boolean;
  workflows: Workflow[];
  connections: Connection[];
};
export const capabilityLabels: Record<string, string> = {
  'image.text_to_image': '文字生图',
  'video.text_to_video': '文字生视频',
  'video.image_to_video': '图生视频',
};
