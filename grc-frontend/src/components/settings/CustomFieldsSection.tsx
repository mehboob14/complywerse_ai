'use client';

/** A record's extra fields, exactly as its module defines them.
 *
 *  The definitions come from the module's settings, so this renders whatever a
 *  tenant configured. The server validates the same rules on save — this only
 *  makes them visible while typing.
 */
export type CustomFieldDef = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  help?: string;
};

const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';

export function CustomFieldsSection({
  fields, values, onChange, title = 'Additional fields',
}: {
  fields: CustomFieldDef[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  title?: string;
}) {
  if (!fields || fields.length === 0) return null;
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-slate-800">{title}</h4>
      <div className="space-y-3">
        {fields.map((f) => {
          const value = values[f.key];
          const label = (
            <label className="mb-1 block text-xs font-medium text-slate-700">
              {f.label}{f.required && <span className="text-rose-500"> *</span>}
            </label>
          );
          return (
            <div key={f.key}>
              {label}
              {f.type === 'textarea' ? (
                <textarea className={input} rows={3} value={(value as string) || ''}
                  onChange={(e) => set(f.key, e.target.value)} />
              ) : f.type === 'select' ? (
                <select className={input} value={(value as string) || ''} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === 'multiselect' ? (
                <div className="flex flex-wrap gap-2">
                  {(f.options || []).map((o) => {
                    const picked = Array.isArray(value) && (value as string[]).includes(o);
                    return (
                      <button
                        key={o}
                        type="button"
                        onClick={() => set(f.key, picked
                          ? (value as string[]).filter((x) => x !== o)
                          : [...((value as string[]) || []), o])}
                        className={`rounded-full border px-2.5 py-1 text-xs ${picked
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              ) : f.type === 'checkbox' ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={!!value} onChange={(e) => set(f.key, e.target.checked)} />
                  Yes
                </label>
              ) : (
                <input
                  className={input}
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  value={(value as string | number) ?? ''}
                  onChange={(e) => set(f.key, f.type === 'number'
                    ? (e.target.value === '' ? null : Number(e.target.value))
                    : e.target.value)}
                />
              )}
              {f.help && <p className="mt-0.5 text-[11px] text-slate-400">{f.help}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default CustomFieldsSection;
