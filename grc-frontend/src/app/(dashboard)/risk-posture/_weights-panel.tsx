'use client';

export const dynamic = 'force-dynamic';

/**
 * Per-tenant risk weight customisation panel.
 *
 * Senior's deferred ask: "har bank apne hisaab se weights tune kare."
 * Operators with `compliance:scan:execute` (admin / scan-operator) can
 * drag sliders to reweight the 5 risk dimensions. Total must equal 100%
 * before Save is enabled.
 *
 * Lives behind a "⚙ Tune weights" button on the Risk Posture page so it
 * doesn't clutter the default dashboard.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { riskPostureApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';

type WeightsResponse = {
  weight_cis: number;
  weight_vuln: number;
  weight_cia: number;
  weight_ctrl: number;
  weight_risk: number;
  preset_name: string;
  updated_at: string | null;
  is_custom: boolean;
  presets: Record<string, Record<string, number>>;
};

const DIM_LABEL: Record<string, string> = {
  cis:  'CIS Benchmark gap',
  vuln: 'Open vulnerabilities',
  cia:  'CIA criticality',
  ctrl: 'Control coverage gap',
  risk: 'Linked-risk residual',
};
// 5-series categorical palette for the five risk dimensions — drives each
// slider's accent colour and its % readout. A genuine multi-value data scale
// (one distinct hue per dimension), not brand chrome, so it is preserved.
const DIM_COLOR: Record<string, string> = {
  cis:  '#2563eb',
  vuln: '#dc2626',
  cia:  '#9333ea',
  ctrl: '#059669',
  risk: '#d97706',
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function WeightsPanel({ open, onClose }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('compliance:scan:execute');

  const q = useQuery<{ data: WeightsResponse }>({
    queryKey: ['risk-weights'],
    queryFn: () => riskPostureApi.getWeights(),
    enabled: open,
  });

  // Local form state — initialised from server, edited via sliders.
  const [w, setW] = useState({ cis: 25, vuln: 30, cia: 15, ctrl: 15, risk: 15 });
  const [preset, setPreset] = useState<string>('Banking (default)');

  useEffect(() => {
    if (q.data?.data) {
      const d = q.data.data;
      setW({
        cis: d.weight_cis, vuln: d.weight_vuln, cia: d.weight_cia,
        ctrl: d.weight_ctrl, risk: d.weight_risk,
      });
      setPreset(d.preset_name || 'Custom');
    }
  }, [q.data?.data]);

  const total = useMemo(
    () => Math.round((w.cis + w.vuln + w.cia + w.ctrl + w.risk) * 100) / 100,
    [w],
  );
  const isValid = Math.abs(total - 100) < 0.5;

  const saveMut = useMutation({
    mutationFn: () => riskPostureApi.updateWeights({
      weight_cis: w.cis, weight_vuln: w.vuln, weight_cia: w.cia,
      weight_ctrl: w.ctrl, weight_risk: w.risk, preset_name: preset,
    }),
    onSuccess: () => {
      toast.toast({ title: 'Weights saved', message: 'Risk Posture will recompute with the new formula on next refresh.', type: 'success' });
      qc.invalidateQueries({ queryKey: ['risk-weights'] });
      // Key must match page.tsx's ['risk-posture.dashboard'] exactly. It was
      // 'risk-posture-dashboard' (hyphen vs dot), so saving weights invalidated
      // nothing and the dashboard only updated on its next 30s poll — while the
      // toast claimed it would recompute.
      qc.invalidateQueries({ queryKey: ['risk-posture.dashboard'] });
      onClose();
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      const detail = err?.response?.data?.detail;
      toast.toast({
        title: 'Save failed',
        message: typeof detail === 'string' ? detail : 'Backend rejected the weights.',
        type: 'error',
      });
    },
  });

  const applyPreset = (name: string) => {
    const presets = q.data?.data?.presets;
    if (!presets || !presets[name]) return;
    const p = presets[name];
    setW({
      cis: p.cis, vuln: p.vuln, cia: p.cia, ctrl: p.ctrl, risk: p.risk,
    });
    setPreset(name);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Tune risk weights</h2>
            <p className="text-xs text-slate-500 mt-1">
              Each bank tunes how much each dimension drives the composite score.
              Total must equal 100%.
            </p>
          </div>
          <button onClick={onClose}
                  className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        </div>

        {/* Presets */}
        <div className="bg-primary-50 border border-primary-100 rounded p-3 mb-4">
          <div className="text-[11px] font-semibold text-slate-700 mb-1">Quick presets</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(q.data?.data?.presets || {}).map((name) => (
              <button
                key={name}
                onClick={() => canEdit && applyPreset(name)}
                disabled={!canEdit}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                  preset === name
                    ? 'bg-primary-100 border-primary-300 text-primary-800'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        {(['cis','vuln','cia','ctrl','risk'] as const).map((dim) => (
          <div key={dim} className="mb-3">
            <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
              <span>{DIM_LABEL[dim]}</span>
              <span style={{ color: DIM_COLOR[dim] }} className="font-semibold">
                {w[dim].toFixed(0)}%
              </span>
            </div>
            <input
              type="range" min="0" max="100" step="1"
              value={w[dim]}
              disabled={!canEdit}
              onChange={(e) => {
                setW({ ...w, [dim]: Number(e.target.value) });
                setPreset('Custom');
              }}
              style={{ accentColor: DIM_COLOR[dim], width: '100%' }}
              className="cursor-pointer disabled:cursor-not-allowed"
            />
          </div>
        ))}

        {/* Total */}
        <div className={`flex items-center justify-between rounded p-3 mt-4 ${
          isValid ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'
        }`}>
          <span className="text-xs text-slate-600">Total</span>
          <span className={`text-sm font-bold ${isValid ? 'text-emerald-700' : 'text-rose-700'}`}>
            {total.toFixed(1)}% {isValid ? '✓' : '— must equal 100%'}
          </span>
        </div>

        {q.data?.data?.updated_at && (
          <p className="text-[11px] text-slate-400 mt-3 text-center">
            Last changed {new Date(q.data.data.updated_at).toLocaleString()}
          </p>
        )}

        {!canEdit && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
            🔒 Read-only view — you need the <code>compliance:scan:execute</code> permission to change weights.
          </p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={!canEdit || !isValid || saveMut.isPending}
            className="px-4 py-2 bg-primary-600 text-[#0a0a0a] text-sm font-medium rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveMut.isPending ? 'Saving…' : 'Save weights'}
          </button>
        </div>
      </div>
    </div>
  );
}
