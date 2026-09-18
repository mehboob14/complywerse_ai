'use client';

type ScanProgressModalProps = {
  open: boolean;
  title: string;
  completed: number;
  total: number;
  currentAssetName?: string | null;
  /** Short label of what triggered this scan — shown to make button intent clear. */
  scope?: 'tenant' | 'asset';
  onDismiss?: () => void;
};

export default function ScanProgressModal({
  open,
  title,
  completed,
  total,
  currentAssetName,
  scope = 'asset',
  onDismiss,
}: ScanProgressModalProps) {
  if (!open) return null;
  const pct = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const scopeBlurb =
    scope === 'tenant'
      ? 'Scan All runs every approved rule against every asset in the tenant that has a matching connection — one rule at a time, sequentially.'
      : 'Scan now / Scan this asset runs every approved rule against this single host only — one rule at a time, sequentially.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 border border-gray-200">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative">
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-ping absolute" />
            <div className="w-3 h-3 bg-blue-600 rounded-full" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>

        {currentAssetName && (
          <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 rounded-md">
            <div className="text-xs uppercase tracking-wide text-blue-600 font-medium">
              Currently scanning
            </div>
            <div className="text-sm font-mono text-blue-900 truncate mt-0.5">
              {currentAssetName}
            </div>
          </div>
        )}

        <div className="text-sm text-gray-600 mb-2 flex items-center justify-between">
          <span>
            <span className="font-semibold text-gray-900">{completed}</span>
            <span className="text-gray-400"> / {total}</span> rules completed
          </span>
          <span className="text-sm font-semibold text-blue-600">{pct}%</span>
        </div>

        <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden mb-4">
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="text-xs text-gray-500 mb-2">
          {scopeBlurb}
        </div>
        <div className="text-xs text-gray-400 mb-4">
          Live host is contacted over WinRM/SSH. Page is locked to prevent state
          conflicts. Modal auto-closes when the scan finishes.
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            disabled={!onDismiss}
            className="text-xs text-gray-500 hover:text-gray-800 underline disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Continue in background
          </button>
        </div>
      </div>
    </div>
  );
}
