import { z } from 'zod';
import { productionTechniques } from '../db/schema';
import { textChecksum } from '../scripts/script-evidence';
import { TextProviderError } from '../providers/text-provider';

const short = z.string().max(2000);
export const shotDraftSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: short,
    shots: z
      .array(
        z
          .object({
            title: z.string().min(1).max(200),
            intent: short,
            description: short,
            framing: z.string().max(200),
            angle: z.string().max(200),
            composition: short,
            cameraMovement: short,
            action: short,
            lighting: short,
            mood: z.string().max(200),
            dialogue: short,
            audioNotes: short,
            durationSeconds: z.number().positive().max(3600).nullable(),
            technique: z.enum(productionTechniques),
            assets: z.array(z.string().max(200)).max(20),
            riskNotes: z.array(z.string().max(500)).max(10),
            sourceSpanIds: z.array(z.string().length(64)).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict();
export type SourceBlock = {
  id: string;
  revisionId: string;
  startOffset: number;
  endOffset: number;
  textHash: string;
  text: string;
};
export const manualShotSchema = shotDraftSchema.shape.shots.element.extend({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000),
  dialogue: z.string().max(20000),
});
const manualDraftSchema = shotDraftSchema.extend({ shots: z.array(manualShotSchema).min(1).max(24) });
export type ManualShot = z.infer<typeof manualShotSchema>;
export function sourceChunks(revisionId: string, content: string) {
  const blocks: SourceBlock[] = [];
  let start = 0;
  for (const match of content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
    let remaining = match[0];
    while (remaining.length) {
      let length = Math.min(remaining.length, 2000);
      const last = remaining.charCodeAt(length - 1),
        next = remaining.charCodeAt(length);
      if (
        (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) ||
        (last === 13 && next === 10)
      )
        length--;
      const text = remaining.slice(0, length),
        end = start + length,
        textHash = textChecksum(text);
      blocks.push({
        id: textChecksum(`${revisionId}:${start}:${end}:${textHash}`),
        revisionId,
        startOffset: start,
        endOffset: end,
        textHash,
        text,
      });
      start = end;
      remaining = remaining.slice(length);
    }
  }
  const chunks: { index: number; startOffset: number; endOffset: number; blocks: SourceBlock[] }[] = [];
  for (const block of blocks) {
    let current = chunks.at(-1);
    if (
      !current ||
      current.endOffset - current.startOffset + block.text.length > 8000 ||
      current.blocks.length >= 40
    ) {
      current = {
        index: chunks.length,
        startOffset: block.startOffset,
        endOffset: block.endOffset,
        blocks: [],
      };
      chunks.push(current);
    }
    current.blocks.push(block);
    current.endOffset = block.endOffset;
  }
  return chunks;
}
export function validateShotDraft(value: unknown, blocks: SourceBlock[], manual = false) {
  const result = (manual ? manualDraftSchema : shotDraftSchema).safeParse(value);
  if (!result.success)
    throw new TextProviderError('PROPOSAL_SCHEMA_INVALID', '模型草案字段不符合制作卡约定，未保存为正式内容');
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const shots = result.data.shots.map((shot) => {
    if (
      new Set(shot.sourceSpanIds).size !== shot.sourceSpanIds.length ||
      shot.sourceSpanIds.some((id) => !byId.has(id))
    )
      throw new TextProviderError('PROPOSAL_SOURCE_INVALID', '模型引用了分析范围之外或重复的来源段落');
    return {
      ...shot,
      sources: shot.sourceSpanIds.map((id) => {
        const { text: _text, ...reference } = byId.get(id)!;
        return reference;
      }),
    };
  });
  return { ...result.data, shots };
}
export const analysisSchemaName = 'studio_shot_draft_v1';
export const structuredOutputSchema = (() => {
  const schema = z.toJSONSchema(shotDraftSchema);
  delete schema.$schema;
  return schema;
})();
