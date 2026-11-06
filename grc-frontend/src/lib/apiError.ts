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

// What a person may be shown of the server's words. Plenty of endpoints answer `detail=str(e)`, so the text can carry an HTML error page from a
// proxy, a stack trace, SQLAlchemy's echo of the statement and its values, or control characters.
const MARKUP = /<(?:script|style)\b[\s\S]*?<\/(?:script|style)>|<\/?[a-z!][^>]*>/gi;
const FRAME = /^\s*(?:File "[^"]*", line \d+.*|at\s.*:\d+(?::\d+)?\)?)\s*$/;          // a Python frame, a JS or Java frame
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;            // all but tab and line breaks, which become spaces below
// The UI says "AI", never a vendor or a model (AGENTS rule 5): a backend that answers "OpenAI API key not configured" is read as "AI API key not configured".
const VENDOR = /\b(?:open[\s-]?ai|anthropic|chat[\s-]?gpt|gpt[-\w.]*|claude[-\w.]*)\b/gi;

/** `text` as one short paragraph that is safe to put on screen: no markup, no stack frames or SQL echo, no control characters, at most `max` characters (cut with "…"). '' when nothing readable is left. */
export function safeDetail(text: string | null | undefined, max = 240): string {
  if (typeof text !== 'string') return '';
  let t = text.replace(/\[SQL:[\s\S]*$/, '');                                            // the statement and its parameters follow the message
  if (t.includes('Traceback (most recent call last)')) t = t.trim().split(/\r?\n/).pop() ?? '';          // Python prints the exception last
  const flat = t.replace(MARKUP, ' ').replace(CONTROLS, '').split(/\r?\n/).filter((line) => !FRAME.test(line)).join(' ').replace(/\s+/g, ' ').replace(VENDOR, 'AI').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).replace(/[\uD800-\uDBFF]$/, '').trimEnd()}…`;          // never end on half an emoji
}
