import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname } from 'node:path';
import { AppConfig } from '../config';
import { LocalStorage, StorageFailure } from '../storage/local-storage';
const execute = promisify(execFile);
const allowedFormats = 'png_pipe,jpeg_pipe,webp_pipe,mov,matroska,webm,wav,mp3,ogg';
type Family = 'png' | 'jpeg' | 'webp' | 'mp4' | 'mov' | 'webm' | 'wav' | 'mp3' | 'ogg';
export type MediaDetails = {
  mediaType: 'image' | 'video' | 'audio';
  mime: string;
  metadata: {
    width: number | null;
    height: number | null;
    durationMs: number | null;
    videoCodec: string | null;
    audioCodecs: string[];
    hasAudio: boolean;
    sampleRate: number | null;
    channels: number | null;
    frameRate: string | null;
    probeVersion: string;
  };
  poster: { key: string; bytes: number; sha256: string; mime: 'image/jpeg' } | null;
};
function family(data: Buffer): Family {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (data.toString('ascii', 4, 8) === 'ftyp')
    return data.toString('ascii', 8, 12) === 'qt  ' ? 'mov' : 'mp4';
  if (data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  if (data.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (
    data.toString('ascii', 0, 3) === 'ID3' ||
    (data[0] === 255 && (data[1] & 0xe0) === 0xe0 && (data[1] & 6) !== 0)
  )
    return 'mp3';
  throw new StorageFailure(
    'MEDIA_TYPE_UNSUPPORTED',
    '不支持此文件内容；请使用PNG/JPEG/WebP、MP4/MOV/WebM或WAV/MP3/OGG',
  );
}
const extensions: Record<Family, string[]> = {
  png: ['.png'],
  jpeg: ['.jpg', '.jpeg'],
  webp: ['.webp'],
  mp4: ['.mp4', '.m4a'],
  mov: ['.mov'],
  webm: ['.webm'],
  wav: ['.wav'],
  mp3: ['.mp3'],
  ogg: ['.ogg', '.opus'],
};
@Injectable()
export class MediaProbe {
  private versions: Promise<{ ffprobe: string; ffmpeg: string }> | undefined;
  constructor(
    private readonly config: AppConfig,
    private readonly storage: LocalStorage,
  ) {}
  ready() {
    if (!this.versions)
      this.versions = Promise.all([
        execute(this.config.ffprobePath, ['-version'], {
          windowsHide: true,
          timeout: 5000,
          maxBuffer: 65536,
        }),
        execute(this.config.ffmpegPath, ['-version'], { windowsHide: true, timeout: 5000, maxBuffer: 65536 }),
      ])
        .then(([probe, ffmpeg]) => ({
          ffprobe: probe.stdout.split(/\r?\n/)[0].slice(0, 200),
          ffmpeg: ffmpeg.stdout.split(/\r?\n/)[0].slice(0, 200),
        }))
        .catch(() => {
          this.versions = undefined;
          throw new StorageFailure(
            'MEDIA_TOOLS_UNAVAILABLE',
            '媒体检测工具不可用，请联系管理员配置FFmpeg和FFprobe',
          );
        });
    return this.versions;
  }
  async inspect(
    key: string,
    posterKey: string,
    fileName: string,
    declaredMime: string,
  ): Promise<MediaDetails> {
    const versions = await this.ready(),
      detected = family(await this.storage.prefix(key));
    if (!extensions[detected].includes(extname(fileName).toLowerCase()))
      throw new StorageFailure('MEDIA_EXTENSION_MISMATCH', '文件后缀与实际内容不一致');
    const path = await this.storage.path(key);
    let value: {
      streams?: {
        codec_type: string;
        codec_name?: string;
        width?: number;
        height?: number;
        duration?: string;
        sample_rate?: string;
        channels?: number;
        r_frame_rate?: string;
        disposition?: { attached_pic?: number };
      }[];
      format?: { duration?: string; format_name?: string };
    };
    try {
      const output = await execute(
        this.config.ffprobePath,
        [
          '-v',
          'error',
          '-probesize',
          '5000000',
          '-analyzeduration',
          '5000000',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          allowedFormats,
          '-show_entries',
          'stream=codec_type,codec_name,width,height,duration,sample_rate,channels,r_frame_rate:stream_disposition=attached_pic:format=duration,format_name',
          '-of',
          'json',
          path,
        ],
        { windowsHide: true, timeout: 20000, maxBuffer: 262144 },
      );
      value = JSON.parse(output.stdout);
    } catch {
      throw new StorageFailure('MEDIA_INVALID', '无法完整识别媒体文件，未归档');
    }
    const streams = value.streams ?? [];
    if (!streams.length || streams.length > 32)
      throw new StorageFailure('MEDIA_INVALID', '媒体流不存在或数量超出限制');
    const video = streams.find(
        (stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic,
      ),
      audio = streams.filter((stream) => stream.codec_type === 'audio');
    const image = ['png', 'jpeg', 'webp'].includes(detected);
    const mediaType = image ? 'image' : video ? 'video' : 'audio';
    if (extname(fileName).toLowerCase() === '.m4a' && video)
      throw new StorageFailure('MEDIA_EXTENSION_MISMATCH', 'M4A文件应为声音媒体');
    if ((image && !video) || (!video && !audio.length))
      throw new StorageFailure('MEDIA_INVALID', '文件没有有效图像或声音流');
    if (
      video &&
      (!video.width ||
        !video.height ||
        video.width > 16384 ||
        video.height > 16384 ||
        video.width * video.height > 40000000)
    )
      throw new StorageFailure('MEDIA_DIMENSIONS_LIMIT', '媒体尺寸超过当前处理范围');
    const duration = Number(value.format?.duration ?? video?.duration ?? audio[0]?.duration);
    if (!image && (!Number.isFinite(duration) || duration <= 0 || duration > 86400))
      throw new StorageFailure('MEDIA_DURATION_INVALID', '媒体时长无效或超过24小时');
    const mime: Record<Family, string> = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      mp4: mediaType === 'audio' ? 'audio/mp4' : 'video/mp4',
      mov: 'video/quicktime',
      webm: mediaType === 'audio' ? 'audio/webm' : 'video/webm',
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
    };
    const normalized =
      (
        {
          'audio/x-wav': 'audio/wav',
          'audio/wave': 'audio/wav',
          'audio/mp3': 'audio/mpeg',
          'image/jpg': 'image/jpeg',
        } as Record<string, string>
      )[declaredMime] ?? declaredMime;
    if (normalized && normalized !== 'application/octet-stream' && normalized !== mime[detected])
      throw new StorageFailure('MEDIA_MIME_MISMATCH', '声明的媒体类型与实际流不一致');
    let poster: MediaDetails['poster'] = null;
    if (video) {
      try {
        await execute(
          this.config.ffmpegPath,
          [
            '-nostdin',
            '-v',
            'error',
            '-n',
            '-threads',
            '1',
            '-protocol_whitelist',
            'file,pipe',
            '-format_whitelist',
            allowedFormats,
            '-i',
            path,
            '-map',
            '0:v:0',
            '-frames:v',
            '1',
            '-threads',
            '1',
            '-vf',
            "scale='min(640,iw)':-2",
            '-map_metadata',
            '-1',
            '-c:v',
            'mjpeg',
            '-q:v',
            '3',
            '-f',
            'image2',
            '-update',
            '1',
            await this.storage.path(posterKey),
          ],
          { windowsHide: true, timeout: 30000, maxBuffer: 65536 },
        );
        const verified = await this.storage.digest(posterKey);
        if (!verified.bytes || verified.bytes > 5242880) throw new Error('poster size');
        poster = { ...verified, mime: 'image/jpeg' };
      } catch {
        throw new StorageFailure('MEDIA_DECODE_FAILED', '媒体解码或封面生成失败，未归档');
      }
    }
    return {
      mediaType,
      mime: mime[detected],
      metadata: {
        width: video?.width ?? null,
        height: video?.height ?? null,
        durationMs: image ? null : Math.round(duration * 1000),
        videoCodec: video?.codec_name ?? null,
        audioCodecs: audio.map((stream) => stream.codec_name ?? 'unknown'),
        hasAudio: audio.length > 0,
        sampleRate: audio[0]?.sample_rate ? Number(audio[0].sample_rate) : null,
        channels: audio[0]?.channels ?? null,
        frameRate: video?.r_frame_rate ?? null,
        probeVersion: versions.ffprobe,
      },
      poster,
    };
  }
}
