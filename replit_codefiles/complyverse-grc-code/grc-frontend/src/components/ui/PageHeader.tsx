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
  primary: 'bg-primary-600/20 text-primary-400',
  success: 'bg-emerald-600/20 text-emerald-400',
  warning: 'bg-amber-600/20 text-amber-400',
  danger: 'bg-rose-600/20 text-rose-400',
  info: 'bg-cyan-600/20 text-cyan-400',
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
              'flex items-center justify-center w-12 h-12 rounded-xl flex-shrink-0',
              iconColorClasses[iconColor]
            )}>
              <Icon size={24} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-slate-400 text-sm leading-relaxed max-w-2xl">
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
