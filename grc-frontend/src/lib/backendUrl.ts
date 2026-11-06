/**
 * Backend base URL for server-side proxy routes, always ending in `/grc`.
 *
 * `BACKEND_URL` is set both ways across environments (`http://host:4000` and
 * `http://host:4000/grc`). Routes that appended `/grc` themselves produced
 * `/grc/grc/...` and a 404 wherever the variable already carried it — which is
 * how policy parsing broke locally.
 */
export function backendGrcBase(): string {
  const raw = (
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    'http://127.0.0.1:4000/grc'
  ).replace(/\/+$/, '');
  return raw.endsWith('/grc') ? raw : `${raw}/grc`;
}
