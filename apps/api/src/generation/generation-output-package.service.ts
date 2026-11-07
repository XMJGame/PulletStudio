import { Injectable } from '@nestjs/common';
import { CurrentUser, fail } from '../common/http';
import { MediaService } from '../assets/media.service';
import { GenerationService } from './generation.service';
import { packageLimits } from '../exports/media-package-contract';
import { packageExtensions, streamVerifiedZip, verifyZipFiles } from '../exports/verified-zip';

@Injectable()
export class GenerationOutputPackageService {
  constructor(
    private readonly generation: GenerationService,
    private readonly media: MediaService,
  ) {}
  private snapshot(user: CurrentUser, id: string, outputIds: (string | null)[]) {
    const { job, files } = this.generation.candidateFiles(user, id, outputIds);
    const selected = files.map(({ version, ...output }, index) => {
      const extension = packageExtensions[version.mime];
      if (!extension) fail(409, 'PACKAGE_MEDIA_UNSUPPORTED', '所选产物包含暂不支持的媒体类型');
      const base =
        version.fileName
          .replace(/\.[^.]*$/u, '')
          .replace(/[\\/:%<>"|?*\x00-\x1f\x7f]/gu, '_')
          .replace(/\.{2,}/gu, '_')
          .replace(/[. ]+$/u, '')
          .slice(0, 100) || 'media';
      const folder =
        version.mediaType === 'video' ? '01_Video' : version.mediaType === 'audio' ? '02_Audio' : '03_Images';
      return {
        ...output,
        mediaVersionId: version.id,
        path: `${folder}/${String(index + 1).padStart(3, '0')}_${base}.${extension}`,
        fileName: version.fileName,
        mime: version.mime,
        byteLength: version.byteLength,
        sha256: version.sha256,
        metadata: version.metadata,
      };
    });
    const mediaBytes = selected.reduce((total, file) => total + file.byteLength, 0);
    if (mediaBytes > packageLimits.mediaBytes)
      fail(413, 'PACKAGE_MEDIA_LIMIT', '单次原件包最多 2 GiB，请减少所选文件');
    return {
      schemaVersion: 'studio.generation-output-package.v1' as const,
      jobId: job.id,
      projectId: job.projectId,
      workflowId: job.workflowId,
      files: selected,
    };
  }
  preview(user: CurrentUser, id: string, outputIds: (string | null)[]) {
    const snapshot = this.snapshot(user, id, outputIds);
    const query = encodeURIComponent(outputIds.map((value) => value ?? 'main').join(','));
    return {
      fileCount: snapshot.files.length,
      mediaBytes: snapshot.files.reduce((n, file) => n + file.byteLength, 0),
      fileName: `generation-outputs-${id}.zip`,
      downloadPath: `/api/v1/generation-jobs/${id}/output-package?outputIds=${query}`,
    };
  }
  async file(user: CurrentUser, id: string, outputIds: (string | null)[], signal?: AbortSignal) {
    const snapshot = this.snapshot(user, id, outputIds);
    await verifyZipFiles(this.media, user, snapshot.files, signal);
    this.snapshot(user, id, outputIds);
    const result = await streamVerifiedZip({
      media: this.media,
      user,
      files: snapshot.files,
      manifestJson: JSON.stringify({ ...snapshot, exportedAt: new Date().toISOString() }),
      signal,
      authorize: (file) => {
        const current = this.generation.candidateFiles(user, id, [file.outputId]).files[0];
        if (current.version.id !== file.mediaVersionId)
          fail(409, 'PACKAGE_MEDIA_CHANGED', '原件与交付清单不一致');
      },
    });
    return { ...result, fileName: `generation-outputs-${id}.zip` };
  }
}
