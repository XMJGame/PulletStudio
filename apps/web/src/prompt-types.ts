import { DraftShot } from './analysis-types';
import { Project, Shot } from './api';
export type CardBody = Omit<DraftShot, 'sources'> & {
  sourceAudioPolicy: 'keep' | 'mute' | 'inspect' | 'replace';
};
export type CardEditor = {
  shot: Shot & { projectId: string };
  project: Project;
  body: CardBody;
  canEdit: boolean;
  canManage: boolean;
  card: { available: boolean };
};
export type PromptConfig = {
  prefix: string;
  suffix: string;
  positiveRules: string[];
  negativeRules: string[];
  negativeMode: 'separate' | 'inline';
};
export type PromptProfile = {
  id: string;
  profileId: string;
  name: string;
  version: number;
  config: PromptConfig;
};
export type PromptArtifact = {
  id: string | null;
  createdAt?: string;
  snapshot: {
    card: { version: number };
    project: { version: number };
    profile: { name: string; version: number | string };
  };
  rendered: { positivePrompt: string; negativePrompt: string; warnings: string[]; productionReady: boolean };
  freshness: { stale: boolean; reasons: string[] };
};
