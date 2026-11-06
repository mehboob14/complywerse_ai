'use client';

// The frame every signed-in page sits in. Left to right: the icon rail (from 1024) and a column made of the top bar over a row of the page and the docked Work and context panel.
//
//   +------+--------------------------------------------+
//   | rail | top bar (crumbs, command bar, ...)          |
//   |      +----------------------------------+---------+
//   |      | main: the page                   | panel   |
//   +------+----------------------------------+---------+
//
// `main` keeps exactly the padding it always had (p-4, lg:p-5), because a dozen pages and layouts cancel it with a negative margin (-m-4 lg:-m-5) to run edge to edge: removing the
// padding here would clip them, and they are not this file's to edit (the report lists them). The top bar stays 48px for the same reason: pages that fill the window size
// themselves against it (100dvh - 3rem). Below 1440 the panel is not in the row: it opens over the page (SidePanel).
import type { ReactNode } from 'react';
import NavProgress from '@/components/layout/NavProgress';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import IdleLogout from '@/components/IdleLogout';
import { GuidePanel } from '@/components/guide';
import { ShellProvider, useShell } from './ShellProvider';
import { PinnedRecentProvider } from './PinnedRecentProvider';
import WorkPanel from './WorkPanel';
import CommandPalette from './CommandPalette';

// A page's own bar that sticks to the top of `main` (a toolbar, a live meeting's bar: 60 to 90px, below main's padding or reaching up through it) hides what the keyboard scrolls to the
// top edge of `main`. `scroll-padding-top` keeps a focused element, or one a link scrolls to, that far below the edge, so it is never under such a bar. A taller bar needs a larger value.
const STICKY_PAD = '96px';

const SKIP = 'sr-only focus:not-sr-only focus:fixed focus:top-3 focus:z-[3000] focus:rounded-ds-control focus:bg-ds-primary focus:px-[12px] focus:py-[8px] focus:text-ds-body focus:font-[500] focus:text-ds-on-primary focus:shadow-ds-pop focus-visible:outline-none focus-visible:shadow-ds-ring';

/** The second stop for the keyboard: straight to the person's queue in the panel (opening it when it is shut). The first, in the layout's own words, goes to the page. */
function SkipToQueue() {
  const { requestPanelFocus } = useShell();
  return <button type="button" onClick={requestPanelFocus} className={`${SKIP} focus:left-[200px]`}>Skip to Needs my action</button>;
}

export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <ShellProvider>
      <PinnedRecentProvider>
        <div className="platform-ui compact-density cw-dashboard flex h-screen overflow-hidden bg-[var(--color-subtle)]">
          {/* First stops for the keyboard: past the menu and the top bar, to the page or to the queue. Visible only while they have focus. */}
          <a href="#main-content" className={`${SKIP} focus:left-3`}>Skip to content</a>
          <SkipToQueue />
          <NavProgress />
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Header />
            <div className="flex min-h-0 flex-1">
              {/* `relative`: the kit's visually hidden labels (sr-only) are absolutely positioned; with no positioned box around them they were placed against the window, outside this scroll box, and a long list stretched the document: the whole shell scrolled (a phone's top bar slid away) */}
              <main id="main-content" tabIndex={-1} className="relative min-w-0 flex-1 overflow-auto bg-[var(--color-subtle)] p-4 lg:p-5 scrollbar-thin focus:outline-none" style={{ scrollPaddingTop: STICKY_PAD }}>
                {children}
              </main>
              <WorkPanel />
            </div>
          </div>
          {/* Idle-timeout sentinel — reads the tenant's policy and logs the user out after the configured window of no activity. */}
          <IdleLogout />
          {/* Guide mode slide-over — renders nothing until a marker is clicked. */}
          <GuidePanel />
          <CommandPalette />
        </div>
      </PinnedRecentProvider>
    </ShellProvider>
  );
}
