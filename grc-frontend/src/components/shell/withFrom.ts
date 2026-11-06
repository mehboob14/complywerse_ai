// An in-app link that remembers the page it is drawn on: the shell reads `?from=` to keep that page's menu entry lit and to put the page in the trail when the person arrives
// (railModel.litFor, crumbsModel). `here` is the path (and query) of the page the link is on. A link that is not a page of this app, one that already says where it came from,
// or a place that is not a page is returned as it was. (`node --test src/components/shell/withFrom.test.ts`)
import { appPath } from '../layout/headerLinks.ts';

export function withFrom(href: string, here: string): string {
  const to = appPath(href);
  const origin = appPath(here);
  if (!to || !origin || /[?&]from=/.test(to.split('#')[0])) return href;
  const hash = to.indexOf('#');
  const base = hash < 0 ? to : to.slice(0, hash);
  return `${base}${base.includes('?') ? '&' : '?'}from=${encodeURIComponent(origin)}${hash < 0 ? '' : to.slice(hash)}`;
}
