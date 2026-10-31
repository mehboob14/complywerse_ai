// What a Notice decides apart from React, so `node --test` can pin it (notice.test.ts): which live-region role a tone speaks with. The banner is
// components/ui/ds/Notice.tsx.

export type NoticeTone = 'info' | 'warning' | 'danger';
export type NoticeRole = 'status' | 'alert';

/** The role of the banner. Information is polite (`status`: read out when the screen reader is idle); a warning or a danger is `alert` (read out
 *  at once). A page that shows the notice from the moment it loads, not as the answer to something the person did, passes `role="status"`:
 *  an alert that is already there when the page opens is not announced reliably, and one that fires on every visit is noise. */
export function noticeRole(tone: NoticeTone, override?: NoticeRole): NoticeRole {
  return override ?? (tone === 'info' ? 'status' : 'alert');
}
