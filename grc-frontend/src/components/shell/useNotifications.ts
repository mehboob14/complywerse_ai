'use client';

// The notifications of the bell (workflow in-app notifications): the 20 newest, polled every 30 s, read at once on screen and then told to the server (the refetch corrects it if that
// failed). The bell in the top bar and the palette's "Mark all notifications read" share this one query and these two functions, which were the Header's own.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface AppNotification {
  id: number;
  subject: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string;
  link?: string | null;
  url?: string | null;
}

export const NOTIFICATIONS_KEY = ['workflow-notifications'];

export function useNotifications(enabled: boolean) {
  const queryClient = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiClient.get('/workflow-engine/notifications/in-app?limit=20').then((r) => r.data),
    refetchInterval: 30000, // poll every 30s
    enabled,
  });
  const items: AppNotification[] = data?.items ?? [];
  const unread = items.filter((n) => !n.is_read).length;

  // shown as read at once (row and badge), then told to the server; the refetch corrects it if that failed
  const showRead = (id?: number) => {
    void queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });     // a poll already on its way would show it unread again
    queryClient.setQueryData(NOTIFICATIONS_KEY, (old: any) => (Array.isArray(old?.items)
      ? { ...old, items: old.items.map((n: any) => (id === undefined || n.id === id ? { ...n, is_read: true } : n)) } : old));
  };

  const markAllRead = async () => {
    showRead();
    try {
      await apiClient.post('/workflow-engine/notifications/in-app/read-all');
    } catch {/* ignore */}
    void refetch();
  };

  const markOneRead = async (id: number) => {
    showRead(id);
    try {
      await apiClient.post(`/workflow-engine/notifications/in-app/${id}/read`);
    } catch {/* ignore */}
    void refetch();
  };

  return { items, unread, refetch, markAllRead, markOneRead };
}
