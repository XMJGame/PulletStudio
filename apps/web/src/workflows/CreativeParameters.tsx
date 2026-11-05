import type { AvailableField, FieldValues } from '../../../../packages/contracts/src/workflow';
export function creativeValues(
  fields: AvailableField[],
  overrides: Record<string, string | boolean>,
): FieldValues {
  return Object.fromEntries(
    fields.map((field) => {
      const raw = overrides[field.id] ?? field.defaultValue;
      if (field.type === 'number' && (raw === '' || !Number.isFinite(Number(raw))))
        throw new Error(`${field.label}需要有效数值`);
      return [field.id, field.type === 'number' ? Number(raw) : raw];
    }),
  );
}
export function CreativeParameters({
  fields,
  overrides,
  change,
}: {
  fields: AvailableField[];
  overrides: Record<string, string | boolean>;
  change: (id: string, value: string | boolean) => void;
}) {
  return (
    <div className="creative-parameters">
      {fields.map((field) => (
        <label key={field.id} className={field.type === 'boolean' ? 'checkbox-label' : undefined}>
          {field.type === 'boolean' ? (
            <>
              <input
                aria-label={`创作参数：${field.label}`}
                type="checkbox"
                checked={Boolean(overrides[field.id] ?? field.defaultValue)}
                onChange={(event) => change(field.id, event.target.checked)}
              />
              {field.label}
            </>
          ) : (
            <>
              {field.label}
              {field.type === 'enum' ? (
                <select
                  aria-label={`创作参数：${field.label}`}
                  value={String(overrides[field.id] ?? field.defaultValue)}
                  onChange={(event) => change(field.id, event.target.value)}
                >
                  {field.options.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : field.type === 'number' ? (
                <input
                  aria-label={`创作参数：${field.label}`}
                  type="number"
                  required
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={String(overrides[field.id] ?? field.defaultValue)}
                  onChange={(event) => change(field.id, event.target.value)}
                />
              ) : (
                <textarea
                  aria-label={`创作参数：${field.label}`}
                  rows={2}
                  maxLength={field.maxLength}
                  value={String(overrides[field.id] ?? field.defaultValue)}
                  onChange={(event) => change(field.id, event.target.value)}
                />
              )}
            </>
          )}
        </label>
      ))}
    </div>
  );
}
