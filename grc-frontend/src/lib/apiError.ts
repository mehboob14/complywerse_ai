// What went wrong, as people read it, from an API error. FastAPI's `detail` is a sentence, a list of {loc, msg} (a 422), or an
// object of the endpoint's own; put on a page as it is, a list or an object blanks the page (React cannot render one).

const NOT_A_FIELD = new Set(['body', 'query', 'path', 'header', 'cookie']);

/** One problem of a 422 list: "Email: value is not a valid email address." */
function problem(item: unknown): string {
  if (!item || typeof item !== 'object') return detailText(item);
  const { loc, msg } = item as { loc?: unknown; msg?: unknown };
  const text = detailText(msg ?? item).replace(/^value error,\s*/i, '');
  if (!text) return '';
  const field = Array.isArray(loc) ? [...loc].reverse().find((p) => typeof p === 'string' && !NOT_A_FIELD.has(p)) as string | undefined : undefined;
  const label = field ? field.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '';
  const said = label ? `${label}: ${text}` : text.replace(/^./, (c) => c.toUpperCase());
  return /[.!?]$/.test(said) ? said : `${said}.`;
}

/** A `detail` as readable text, whatever its shape ('' when it holds none). */
export function detailText(detail: unknown): string {
  if (typeof detail === 'string') return detail.trim();
  if (Array.isArray(detail)) return detail.map(problem).filter(Boolean).join(' ');
  if (detail && typeof detail === 'object') {
    const o = detail as Record<string, unknown>;
    return detailText(o.message ?? o.msg ?? o.detail ?? o.error);
  }
  return '';
}

/** An axios error as one readable sentence: the server's `detail`, else `fallback`. */
export function apiErrorText(error: unknown, fallback: string): string {
  return detailText((error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail) || fallback;
}
