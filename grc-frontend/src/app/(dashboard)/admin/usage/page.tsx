import { redirect } from 'next/navigation';

// Usage Monitoring is the Activity view of AI usage now (one page for tokens, people and calls). The old address keeps working.
export default function UsageMonitoringForward() {
  redirect('/admin/ai-usage?view=activity');
}
