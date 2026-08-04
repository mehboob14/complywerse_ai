import type { ReactNode } from 'react';
import { Link } from 'wouter';

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  primaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  /** Optional supporting visual / illustration above the title. */
  children?: ReactNode;
};

/** Standardised empty-state block used across dashboards.
 *
 * Replaces the bare "No data yet" sentences scattered across pages.
 * Gives operators a clear next step instead of a dead end.
 */
export default function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6 bg-white border border-dashed border-gray-300 rounded-xl">
      {children}
      {icon ? (
        <div className="w-16 h-16 mb-3 rounded-2xl bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center text-blue-600 text-3xl">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-gray-900 mb-1.5">{title}</h3>
      {description ? (
        <p className="text-sm text-gray-500 max-w-md mb-5">{description}</p>
      ) : null}
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap gap-2 justify-center">
          {primaryAction &&
            (primaryAction.href ? (
              <Link
                href={primaryAction.href}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
              >
                {primaryAction.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={primaryAction.onClick}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
              >
                {primaryAction.label}
              </button>
            ))}
          {secondaryAction &&
            (secondaryAction.href ? (
              <Link
                href={secondaryAction.href}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
              >
                {secondaryAction.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
              >
                {secondaryAction.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
