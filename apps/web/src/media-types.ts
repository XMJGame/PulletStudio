export type MediaVersion = {
  id: string;
  assetId: string;
  projectId: string;
  version: number;
  fileName: string;
  mediaType: 'image' | 'video' | 'audio';
  mime: string;
  byteLength: number;
  sha256: string;
  origin: string;
  metadata: {
    width: number | null;
    height: number | null;
    durationMs: number | null;
    videoCodec: string | null;
    hasAudio: boolean;
    audioCodecs: string[];
    sampleRate: number | null;
    channels: number | null;
  };
  contentUrl: string;
  downloadUrl: string;
  posterUrl: string | null;
};
export type MediaAsset = { id: string; name: string; version: number; latest: MediaVersion };
export type MediaUpload = {
  id: string;
  fileName: string;
  expectedBytes: number;
  receivedBytes: number;
  state: string;
  errorCode: string | null;
  errorMessage: string | null;
  mediaVersion: MediaVersion | null;
  assetId: string;
  expectedAssetVersion: number;
};
export const takeReviewLabels = {
  draft: '草稿',
  submitted: '待审核',
  approved: '已批准',
  rejected: '已拒绝',
  revoked: '已撤销',
};
type ReviewContext = {
  shotVersion: number;
  projectVersion: number;
  promptId: string | null;
  generationJobId: string | null;
};
export type TakeReviewState = {
  status: keyof typeof takeReviewLabels;
  decisionVersion: number;
  decisionId: string | null;
  stale: boolean;
  context: ReviewContext | null;
  source: { shotVersion: number; projectVersion: number } | null;
};
export type Take = {
  id: string;
  takeNo: number;
  state: 'draft';
  media: MediaVersion;
  review?: TakeReviewState;
};
export type TakeReview = TakeReviewState & {
  takeNo: number;
  canEdit: boolean;
  canReview: boolean;
  nextCursor: number | null;
  items: (ReviewContext & {
    id: string;
    version: number;
    action: 'submit' | 'withdraw' | 'approve' | 'reject' | 'revoke';
    reason: string;
    actorName: string;
    createdAt: string;
  })[];
};
export type TakeSelection = {
  version: number;
  takeId: string | null;
  approvalId: string | null;
  takeNo: number | null;
  valid: boolean;
  invalidReason: string | null;
  canReview: boolean;
  nextCursor: number | null;
  items: {
    id: string;
    version: number;
    takeId: string | null;
    takeNo: number | null;
    reason: string;
    actorName: string;
    createdAt: string;
  }[];
};
