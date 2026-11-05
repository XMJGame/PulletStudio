import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { AppConfig } from '../config';
import { CurrentUser, fail } from '../common/http';
import { MediaService } from '../assets/media.service';
import { TimelineSnapshot } from './timeline-contract';
const execute = promisify(execFile);
const sourceFormats = 'image2,png_pipe,jpeg_pipe,webp_pipe,mov,matroska,webm';
@Injectable()
export class AnimaticRenderer {
  constructor(
    private readonly media: MediaService,
    private readonly config: AppConfig,
  ) {}
  private async ffmpeg(args: string[], directory: string, signal: AbortSignal) {
    await execute(
      this.config.ffmpegPath,
      ['-nostdin', '-v', 'error', '-xerror', '-y', '-filter_threads', '1', ...args],
      {
        cwd: directory,
        windowsHide: true,
        timeout: 180000,
        maxBuffer: 512000,
        signal,
      },
    );
  }
  async render(
    user: CurrentUser,
    snapshot: TimelineSnapshot,
    directory: string,
    signal: AbortSignal,
    check: () => void,
  ) {
    const sources = new Map<string, string>();
    for (const [index, file] of snapshot.sources.files.entries()) {
      check();
      const extension = file.mime.split('/')[1] === 'jpeg' ? 'jpg' : file.path.split('.').at(-1)!;
      const path = resolve(directory, `source-${index}.${extension}`);
      const source = await this.media.content(user, file.mediaVersionId, false);
      const hash = createHash('sha256');
      let bytes = 0;
      const verified = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          hash.update(chunk);
          done(null, chunk);
        },
      });
      await pipeline(source.stream, verified, createWriteStream(path, { flags: 'wx', mode: 0o600 }), {
        signal,
      });
      if (bytes !== file.byteLength || hash.digest('hex') !== file.sha256)
        fail(409, 'ANIMATIC_SOURCE_INVALID', '源原件与时间线快照不一致');
      sources.set(file.mediaVersionId, path);
      check();
    }
    const segments: string[] = [];
    for (const [index, clip] of snapshot.clips.entries()) {
      check();
      const duration = (clip.durationMs / 1000).toFixed(3);
      const input = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', sourceFormats, '-threads', '2'];
      if (clip.mediaType === 'image')
        input.push('-f', 'image2', '-pattern_type', 'none', '-loop', '1', '-framerate', '25');
      else input.push('-ss', (clip.inMs / 1000).toFixed(3));
      input.push('-i', sources.get(clip.mediaVersionId)!);
      const keep = clip.audioPolicy === 'keep' && clip.hasAudio;
      if (!keep) input.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
      const videoFilter = [
        `scale=${snapshot.width}:${snapshot.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        `pad=${snapshot.width}:${snapshot.height}:(ow-iw)/2:(oh-ih)/2`,
        'setsar=1',
        'fps=25:start_time=0:round=up',
        `tpad=stop_mode=clone:stop_duration=${duration}`,
        `trim=end_frame=${clip.frames}`,
      ].join(',');
      const fileName = `clip-${index}.mkv`;
      await this.ffmpeg(
        [
          ...input,
          '-map',
          '0:v:0',
          '-map',
          keep ? '0:a:0' : '1:a:0',
          '-vf',
          videoFilter,
          '-af',
          `aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS`,
          '-t',
          duration,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '28',
          '-pix_fmt',
          'yuv420p',
          '-threads',
          '2',
          '-g',
          '25',
          '-bf',
          '0',
          '-c:a',
          'pcm_s16le',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-map_metadata',
          '-1',
          '-f',
          'matroska',
          fileName,
        ],
        directory,
        signal,
      );
      segments.push(`file '${fileName}'`);
    }
    check();
    await writeFile(resolve(directory, 'segments.txt'), segments.join('\n') + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    const path = resolve(directory, 'animatic.mp4');
    await this.ffmpeg(
      [
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'concat,matroska',
        '-f',
        'concat',
        '-safe',
        '1',
        '-i',
        'segments.txt',
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-t',
        (snapshot.durationMs / 1000).toFixed(3),
        '-map_metadata',
        '-1',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        path,
      ],
      directory,
      signal,
    );
    const probed = await execute(
      this.config.ffprobePath,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'mov',
        '-count_frames',
        '-show_entries',
        'stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames:format=duration',
        '-of',
        'json',
        path,
      ],
      { windowsHide: true, timeout: 120000, maxBuffer: 262144, signal },
    );
    const details = JSON.parse(probed.stdout) as {
      streams?: {
        codec_type: string;
        codec_name: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        nb_read_frames?: string;
      }[];
      format?: { duration?: string };
    };
    const video = details.streams?.find((stream) => stream.codec_type === 'video');
    const audio = details.streams?.find((stream) => stream.codec_type === 'audio');
    const frames = snapshot.clips.reduce((sum, clip) => sum + clip.frames, 0);
    if (
      !video ||
      video.codec_name !== 'h264' ||
      video.width !== snapshot.width ||
      video.height !== snapshot.height ||
      video.r_frame_rate !== '25/1' ||
      Number(video.nb_read_frames) !== frames ||
      audio?.codec_name !== 'aac' ||
      Math.abs(Number(details.format?.duration) * 1000 - snapshot.durationMs) > 80
    )
      fail(409, 'ANIMATIC_OUTPUT_INVALID', '预演实际尺寸、帧数、时长或音轨不符合时间线');
    const byteLength = (await stat(path)).size;
    if (byteLength < 1 || byteLength > this.config.mediaMaxBytes)
      fail(413, 'MEDIA_SIZE_LIMIT', '预演文件超出媒体归档上限');
    check();
    return { path, byteLength };
  }
}
