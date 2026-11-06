export type StudioMedia = {
  id: string;
  title: string;
  image: string;
  kind: 'image' | 'video';
  video?: string;
  duration?: string;
};
export type StudioScene = {
  title: string;
  media: StudioMedia[];
  reference?: StudioMedia;
  mood?: StudioMedia;
  prompt?: string;
  savedResult?: StudioMedia;
};
export type RunState = 'idle' | 'running' | 'failed' | 'completed';
export type StudioRunInput = {
  workflow: string;
  prompt: string;
  frame?: StudioMedia;
  seconds: number;
  ratio: string;
  previewFailure: boolean;
};
