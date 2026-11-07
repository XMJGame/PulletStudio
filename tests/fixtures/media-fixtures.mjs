import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
const execute = promisify(execFile);
export async function createMediaFixtures(directory, ffmpeg) {
  await mkdir(directory, { recursive: true });
  const definitions = {
    'image.png': ['-f', 'lavfi', '-i', 'color=c=teal:s=96x64', '-frames:v', '1', '-threads', '1'],
    'image.jpg': ['-f', 'lavfi', '-i', 'color=c=orange:s=96x64', '-frames:v', '1', '-threads', '1'],
    'image.webp': ['-f', 'lavfi', '-i', 'color=c=blue:s=96x64', '-frames:v', '1', '-threads', '1'],
    'clip.mp4': [
      '-f',
      'lavfi',
      '-i',
      'color=c=teal:s=96x64:r=12',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=330:sample_rate=22050',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
    ],
    'motion.mp4': [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=96x64:rate=10',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
    ],
    'clip.webm': [
      '-f',
      'lavfi',
      '-i',
      'color=c=purple:s=96x64:r=10',
      '-t',
      '1',
      '-c:v',
      'libvpx-vp9',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
    ],
    'sound.wav': [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=22050',
      '-t',
      '1',
      '-c:a',
      'pcm_s16le',
    ],
    'sound.mp3': [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=22050',
      '-t',
      '1',
      '-c:a',
      'libmp3lame',
    ],
    'sound.ogg': [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=22050',
      '-t',
      '1',
      '-c:a',
      'libvorbis',
    ],
    'sound.m4a': ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050', '-t', '1', '-c:a', 'aac'],
    'sound.opus': ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:a', 'libopus'],
    'clip.mov': [
      '-f',
      'lavfi',
      '-i',
      'color=c=teal:s=96x64:r=12',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-pix_fmt',
      'yuv420p',
    ],
  };
  const files = {};
  for (const [name, args] of Object.entries(definitions)) {
    const path = join(directory, name);
    await execute(ffmpeg, ['-nostdin', '-v', 'error', '-y', ...args, path], {
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 65536,
    });
    files[name] = { path, bytes: await readFile(path) };
  }
  return files;
}
