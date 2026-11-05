import { createHash } from 'node:crypto';
import { fail } from '../common/http';

export const textChecksum = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
export type SourceInput =
  { type: 'paste'; text: string } | { type: 'file'; fileName: string; base64: string };
export type ParsedSource = {
  fileName: string;
  kind: 'novel' | 'script' | 'narration' | 'brief';
  origin: 'file' | 'paste';
  encoding: string;
  sha256: string;
  byteLength: number;
  originalBytes: Buffer;
  content: string;
};
export function parseScriptSource(source: SourceInput, kind: ParsedSource['kind']): ParsedSource {
  let bytes: Buffer;
  let fileName = 'pasted-text.txt';
  if (source.type === 'file') {
    fileName = source.fileName;
    if (!/\.(txt|md|markdown)$/i.test(fileName) || /[\\/\u0000-\u001f\u007f<>:"|?*]/.test(fileName))
      fail(400, 'UNSUPPORTED_SOURCE', '请选择 UTF-8 编码的 TXT 或 Markdown 文件，文件名不能包含路径');
    bytes = Buffer.from(source.base64, 'base64');
    if (bytes.toString('base64') !== source.base64) fail(400, 'INVALID_SOURCE', '文件内容编码无效');
  } else bytes = Buffer.from(source.text, 'utf8');
  if (!bytes.length || bytes.length > 180000)
    fail(400, 'SOURCE_TOO_LARGE', '原始文本须在 1–180,000 字节以内');
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail(400, 'UNSUPPORTED_ENCODING', '文件不是有效 UTF-8 文本，请另存为 UTF-8 后重试');
  }
  if (source.type === 'paste' && content !== source.text)
    fail(400, 'INVALID_UNICODE', '粘贴文本包含无效 Unicode 字符，请检查原文');
  if (content.startsWith('\uFEFF')) content = content.slice(1);
  if (
    content.length > 60000 ||
    !content.trim() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)
  )
    fail(400, 'INVALID_SOURCE_TEXT', '文本须非空、最多 60,000 字符，且不能包含二进制控制字符');
  return {
    fileName,
    kind,
    origin: source.type,
    encoding: 'utf-8',
    sha256: textChecksum(bytes),
    byteLength: bytes.length,
    originalBytes: bytes,
    content,
  };
}

export function sourceSpans(revisionId: string, content: string, after: number, limit: number) {
  // Offsets refer to the exact immutable revision string, in JS/DOM UTF-16 units.
  // Include separators, blank lines and final newline so no source characters disappear.
  const items = [];
  let offset = 0;
  for (const match of content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
    const text = match[0];
    if (!text.length) continue;
    const startOffset = offset;
    offset += text.length;
    if (startOffset < after && offset > after) fail(400, 'INVALID_CURSOR', '段落游标必须位于完整段落边界');
    if (startOffset >= after) {
      const textHash = textChecksum(text);
      items.push({
        id: textChecksum(`${revisionId}:${startOffset}:${offset}:${textHash}`),
        revisionId,
        startOffset,
        endOffset: offset,
        textHash,
        text,
      });
    }
    if (items.length > limit) break;
  }
  if (after > content.length) fail(400, 'INVALID_CURSOR', '段落游标超出原文范围');
  return {
    revisionId,
    offsetUnit: 'utf16' as const,
    checksum: textChecksum(content),
    items: items.slice(0, limit),
    nextCursor: items.length > limit ? items[limit - 1].endOffset : null,
  };
}
