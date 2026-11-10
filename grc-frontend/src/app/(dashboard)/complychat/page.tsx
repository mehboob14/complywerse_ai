'use client';

// /complychat — Comply Agent, the AI assistant. The page is _chat/ChatPage; the top bar's question box sends `/complychat?q=…`, which the page reads once.
// Opened without Dashboard > Comply Agent > view (the top bar shows Comply Agent to the same people): the no-access state.
import { Suspense } from 'react';
import PermissionGuard from '@/components/ui/PermissionGuard';
import { NoAccessState } from '@/components/ui/ds/NoAccessState';
import { navPermissions } from '@/components/layout/navAccess';
import { ChatPage } from './_chat/ChatPage';

export default function GuardedComplyChatPage() {
  return (
    <PermissionGuard
      required={navPermissions('/complychat')}
      fallback={<NoAccessState title="You don't have access to Comply Agent" reason="Ask your administrator to give you access." />}
    >
      <Suspense fallback={null}>
        <ChatPage />
      </Suspense>
    </PermissionGuard>
  );
}
