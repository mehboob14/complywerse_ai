// Navigation-registry entry of ComplyChat, the AI assistant (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01; `ownHeading` by agent-chat, 2026-11-10.
// It has no sidebar leaf: the top bar's question box and button open it. navAccess PAGE_PERMISSIONS gives it its right (dashboard:ai_insights:view), which the page checks.
// The page draws the kit's head from _chat/ChatPage (PageHeader variant="page"), so the top bar names nothing (its section is its own name) and "Comply Agent" is on screen once.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {};

export const PAGES: PageSpec[] = [
  { path: '/complychat', label: 'Comply Agent', area: 'complychat', hidden: 'opens from the question box and the Comply Agent button in the top bar', ownHeading: true, keywords: ['ComplyChat', 'ComplyChat AI', 'AI assistant', 'Ask a question', 'Chat'] },
];
