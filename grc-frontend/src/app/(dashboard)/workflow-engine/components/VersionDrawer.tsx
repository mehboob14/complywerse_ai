'use client';

import { RotateCcw, X } from 'lucide-react';
import { WorkflowVersion } from './types';

type Props = {
  versions: WorkflowVersion[];
  loading: boolean;
  onClose: () => void;
  onRollback: (versionId: number) => void;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export function VersionDrawer({ versions, loading, onClose, onRollback }: Props) {
  return (
    <div className="absolute right-0 top-0 h-full w-72 bg-white border-l border-gray-200 shadow-xl z-20 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <span className="text-sm font-bold text-gray-800">Version History</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="text-center py-8 text-xs text-gray-400">Loading versions...</div>
        )}
        {!loading && versions.length === 0 && (
          <div className="text-center py-8 text-xs text-gray-400">No version history yet</div>
        )}
        {!loading && versions.length > 0 && (
          <div className="space-y-2">
            {versions.map((v, idx) => (
              <div
                key={v.id}
                className="border border-gray-200 rounded-lg p-3 bg-white hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-800">
                    v{v.version_number}
                    {idx === 0 && (
                      <span className="ml-1.5 text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">
                        Current
                      </span>
                    )}
                  </span>
                  {idx > 0 && (
                    <button
                      onClick={() => onRollback(v.id)}
                      className="flex items-center gap-1 text-[10px] text-orange-600 hover:text-orange-800 font-semibold"
                      title="Restore this version"
                    >
                      <RotateCcw size={11} />
                      Restore
                    </button>
                  )}
                </div>
                <div className="text-[10px] text-gray-500 mb-0.5">{formatDate(v.created_at)}</div>
                {v.change_summary && (
                  <div className="text-[10px] text-gray-600 mt-1 italic">{v.change_summary}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
