/** The body a Next API proxy route sends on for the backend's reply (read with `response.text()`): its JSON as it is; anything else
 *  (a plain-text "Internal Server Error", an HTML error page, an empty body) becomes `{ detail: failure }`, one plain sentence, so a
 *  page never shows a JSON parse error. The route keeps the backend's status. */
export function proxyBody(text: string, failure: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: failure };
  }
}
