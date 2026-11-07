import type { GenerationJob } from './GenerationDialog';
import { referenceMediaLabels } from '../workflows/workflow-types';

export function selectedGenerationOutput(job: GenerationJob, id?: string): GenerationJob {
  const output = job.outputs?.find((item) => item.id === id);
  return output
    ? {
        ...job,
        selectedOutputId: output.id,
        mediaVersionId: output.mediaVersionId,
        result: output.result,
        inLibrary: output.inLibrary,
      }
    : job;
}
export function GenerationOutputPicker({
  job,
  onChange,
}: {
  job: GenerationJob;
  onChange: (id: string) => void;
}) {
  if (!job.outputs?.length) return null;
  return (
    <label className="generation-output-picker">
      生成产物
      <select
        aria-label="选择生成产物"
        value={job.selectedOutputId ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          主结果
          {job.selectedOutputId ? '' : job.result ? ` · ${referenceMediaLabels[job.result.mediaType]}` : ''}
        </option>
        {job.outputs.map((output) => (
          <option key={output.id} value={output.id}>
            {output.label} · {output.index + 1} · {output.role === 'preview' ? '预览' : '中间结果'}
            {output.result ? ` · ${referenceMediaLabels[output.result.mediaType]}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
