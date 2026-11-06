'use client';

// The checks a stage must meet before it can be completed, as rows: blocking first, then those not answerable yet, then those met.
// Each blocking check on the current stage has a button to where it is cleared. Colours are inline hex: the platform CSS repaints
// slate/green/amber utilities inside the shell.
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { BTN, TONE } from '@/app/(dashboard)/vendor-risk/_ui';
import { FIX_LABEL, openChecks, orderChecks, type Check, type Fix } from '../../../_lib/lifecycleLogic';

function Row({ check, canFix, onFix }: { check: Check; canFix: boolean; onFix: (fix: Fix) => void }) {
  const icon = check.met === true
    ? <CheckCircle2 aria-label="Met" className="h-4 w-4" style={{ color: TONE.success.dot }} />
    : check.met === null
      ? <Clock aria-label="Not checked automatically" className="h-4 w-4" style={{ color: '#64707e' }} />
      : <AlertTriangle aria-label="Blocking" className="h-4 w-4" style={{ color: TONE.warning.dot }} />;
  return (
    <li className="flex items-start gap-2.5 py-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 text-[#1f2933]">{check.text}</p>
        {check.met === false && check.detail && <p className="text-[12px] leading-4 text-[#64707e]">{check.detail}</p>}
        {check.met === null && <p className="text-[12px] leading-4 text-[#64707e]">Not checked automatically</p>}
      </div>
      {check.met === false && check.fix && canFix && (
        <button type="button" className={`${BTN} !h-8 !px-2.5 !text-[13px]`} onClick={() => onFix(check.fix as Fix)}>
          {FIX_LABEL[check.fix]}
        </button>
      )}
    </li>
  );
}

export default function CheckList({ checks, isCurrent, canFix, onFix }: {
  checks: Check[] | null | undefined;
  /** only the current stage is checked; the others say when they will be */
  isCurrent: boolean;
  canFix: boolean;
  onFix: (fix: Fix) => void;
}) {
  if (!isCurrent) return <p className="text-[13px] leading-5 text-[#64707e]">Checked when this stage starts.</p>;
  if (!checks || checks.length === 0) return null;
  const open = openChecks(checks);
  return (
    <div>
      <h4 className="text-[13px] font-semibold leading-5" style={{ color: open ? TONE.warning.text : '#26323d' }}>
        {open ? `${open} to clear` : 'Checks'}
      </h4>
      <ul className="mt-0.5 divide-y divide-[#eef1f4]">
        {orderChecks(checks).map((c) => <Row key={c.key} check={c} canFix={canFix} onFix={onFix} />)}
      </ul>
    </div>
  );
}
