import type { StudioProjectCard } from '../features/projects/StudioProjectGallery';
import type { StudioMedia } from '../features/canvas/studio-canvas-types';

const tide = new URL('./art/tide.svg', import.meta.url).href;
const rain = new URL('./art/rain.svg', import.meta.url).href;
const dunes = new URL('./art/dunes.svg', import.meta.url).href;
const after = new URL('./art/after.svg', import.meta.url).href;

export type ReviewProject = StudioProjectCard;
export const projects: StudioProjectCard[] = [
  { id: 'tide', title: '潮汐以北', category: '短片 · 视觉探索', updated: '今天', cover: tide, boards: 2 },
  { id: 'rain', title: '雨夜信号', category: '概念预告', updated: '昨天', cover: rain, boards: 1 },
  { id: 'dunes', title: '风的地貌', category: '品牌影像', updated: '11 月 3 日', cover: dunes, boards: 1 },
  { id: 'blank', title: '未命名试验', category: '创作草稿', updated: '11 月 2 日', boards: 0 },
];
export const media: StudioMedia[] = [
  { id: 'coast', title: '海岸参考', image: tide, kind: 'image' },
  { id: 'city', title: '雨夜色彩', image: rain, kind: 'image' },
  { id: 'sand', title: '沙丘光线', image: dunes, kind: 'image' },
  { id: 'evening', title: '暮光取景', image: after, kind: 'image' },
];
export const resultArt = after;
export const reviewPrompt = '镜头缓缓推向海边的灯塔。雾气贴着海面移动，远处的暖光在冷色海岸上若隐若现。';
