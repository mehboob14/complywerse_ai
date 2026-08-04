import {
  FileText,
  AlertTriangle,
  Shield,
  Flame,
  BookOpen,
  Activity,
} from 'lucide-react';

export function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const time = new Date(timestamp);
  const diff = now.getTime() - time.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return time.toLocaleDateString();
}

export function getActivityIcon(type: string) {
  switch (type) {
    case 'evidence':
      return FileText;
    case 'risk':
      return AlertTriangle;
    case 'control':
      return Shield;
    case 'incident':
      return Flame;
    case 'document':
      return BookOpen;
    default:
      return Activity;
  }
}

export function getActivityColor(type: string) {
  switch (type) {
    case 'evidence':
      return 'color-base-light';
    case 'risk':
      return 'color-warning-light';
    case 'control':
      return 'color-success-light';
    case 'incident':
      return 'color-danger-light';
    case 'document':
      return 'color-base-light';
    default:
      return 'color-muted-light';
  }
}

export function getActivityColorStyles(type: string) {
  switch (type) {
    case 'evidence':
      return { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.1)' };
    case 'risk':
      return { color: 'var(--color-warning)', backgroundColor: 'rgba(146, 87, 14, 0.1)' };
    case 'control':
      return { color: 'var(--color-success)', backgroundColor: 'rgba(45, 106, 79, 0.1)' };
    case 'incident':
      return { color: 'var(--color-danger)', backgroundColor: 'rgba(155, 28, 28, 0.1)' };
    case 'document':
      return { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.1)' };
    default:
      return { color: 'var(--color-muted)', backgroundColor: 'var(--color-subtle)' };
  }
}

export function getUrgencyColor(urgency: string) {
  switch (urgency) {
    case 'critical':
      return 'urgency-critical';
    case 'high':
      return 'urgency-high';
    case 'medium':
      return 'urgency-medium';
    default:
      return 'urgency-low';
  }
}

export function getUrgencyStyles(urgency: string) {
  switch (urgency) {
    case 'critical':
      return { backgroundColor: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)', borderColor: 'rgba(155, 28, 28, 0.3)' };
    case 'high':
      return { backgroundColor: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)', borderColor: 'rgba(146, 87, 14, 0.3)' };
    case 'medium':
      return { backgroundColor: 'rgba(146, 87, 14, 0.08)', color: 'var(--color-warning)', borderColor: 'rgba(146, 87, 14, 0.2)' };
    default:
      return { backgroundColor: 'var(--color-subtle)', color: 'var(--color-muted)', borderColor: 'var(--color-border)' };
  }
}

export function getScoreColor(score: number): 'success' | 'warning' | 'danger' | 'primary' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  if (score >= 40) return 'primary';
  return 'danger';
}

export function getRiskScoreColor(score: number): string {
  if (score <= 25) return 'var(--color-success)';
  if (score <= 50) return 'var(--color-warning)';
  if (score <= 75) return 'var(--color-warning)';
  return 'var(--color-danger)';
}
