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
    <div className={clsx('mb-4', className)}>
      {showBreadcrumb && (
        <div className="mb-2.5">
          <Breadcrumb items={breadcrumbs} />
        </div>
      )}
      
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {Icon && (
            <div className={clsx(
              'flex-shrink-0',
              iconColorClasses[iconColor]
            )}>
              <Icon size={20} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-black tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 max-w-2xl text-sm leading-snug text-slate-600">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        
        {actions && (
          <div className="flex flex-shrink-0 items-center gap-2.5">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
