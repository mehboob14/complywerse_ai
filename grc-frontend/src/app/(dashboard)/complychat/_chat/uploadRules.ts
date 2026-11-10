// What a chat accepts as an attachment, and the words for a file that is refused. The server enforces the same list and size
// (backend/grc/modules/chatbot/router.py CHAT_UPLOAD_TYPES / CHAT_UPLOAD_MAX_BYTES): keep the two in step. Pure, so `node --test` pins it.

export const ACCEPTED_TYPES = ['txt', 'md', 'csv', 'pdf', 'docx', 'pptx'] as const;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** the `accept` of the file picker */
export const ACCEPT_ATTR = ACCEPTED_TYPES.map((t) => `.${t}`).join(',');
/** said next to the paperclip: what can be attached */
export const UPLOAD_HELP = 'You can attach text, Markdown, CSV, PDF, Word or PowerPoint files, up to 10 MB each.';
/** how many files wait to be sent with one question */
export const MAX_PENDING = 5;

export interface FileLike { name: string; size: number }
export interface Refused { name: string; reason: string }

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/** "2.4 MB", "310 KB", "12 bytes" */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** Why one file cannot be attached, or null when it can. */
export function refusalFor(file: FileLike): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(extensionOf(file.name))) return `${file.name} can't be attached. Use a text, Markdown, CSV, PDF, Word or PowerPoint file.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/** Splits what the person picked into what can wait to be sent and what is refused, keeping at most MAX_PENDING in all (`already` are waiting). */
export function checkFiles<T extends FileLike>(picked: readonly T[], already = 0): { accepted: T[]; refused: Refused[] } {
  const accepted: T[] = [];
  const refused: Refused[] = [];
  for (const file of picked) {
    const reason = refusalFor(file);
    if (reason) refused.push({ name: file.name, reason });
    else if (already + accepted.length >= MAX_PENDING) refused.push({ name: file.name, reason: `${file.name} was not added: at most ${MAX_PENDING} files go with one question.` });
    else accepted.push(file);
  }
  return { accepted, refused };
}
