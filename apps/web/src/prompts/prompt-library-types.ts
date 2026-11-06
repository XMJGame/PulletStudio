export type PromptDraft = {
  title?: string;
  positivePrompt: string;
  negativePrompt?: string;
  source?: string;
  tags?: string[];
  workflowId?: string | null;
  promptLibraryRevisionId?: string;
};
export type LibraryRevision = {
  id: string;
  entryId: string;
  projectId: string;
  version: number;
  title: string;
  positivePrompt: string;
  negativePrompt: string;
  source: string;
  tags: string[];
  workflowId: string | null;
  createdAt: string;
};
export type LibraryView = { currentVersion: number; canEdit: boolean; revision: LibraryRevision };
export type LibrarySummary = { id: string; title: string; version: number; tags: string[]; preview: string };
