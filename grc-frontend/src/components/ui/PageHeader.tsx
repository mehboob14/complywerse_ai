'use client';

import { type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';
import { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  showBreadcrumb?: boolean;
  className?: string;
}

const iconColorClasses = {
  primary: 'text-primary-600',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-rose-600',
  info: 'text-cyan-600',
};

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  iconColor = 'primary',
  actions,
  breadcrumbs,
  showBreadcrumb = true,
  className,
}: PageHeaderProps) {
  return (
    <div className={clsx('mb-6', className)}>
      {showBreadcrumb && (
        <div className="mb-4">
          <Breadcrumb items={breadcrumbs} />
        </div>
      )}
      
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {Icon && (
            <div className={clsx(
              'flex-shrink-0',
              iconColorClasses[iconColor]
            )}>
              <Icon size={24} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-black tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-slate-600 text-sm leading-relaxed max-w-2xl">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        
        {actions && (
          <div className="flex items-center gap-3 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
