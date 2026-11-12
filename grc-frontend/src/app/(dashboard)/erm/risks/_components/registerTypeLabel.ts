// A risk's register_type is a stored value, and some stored values carry the name of the client the template came from. People read this label instead.
const canonical = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function registerTypeLabel(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  const key = canonical(raw);
  if (key === 'ubltemplate') return 'Template';
  if (key.includes('1link')) return '3×3 Template';
  return raw.replace(/_/g, ' ');
}
