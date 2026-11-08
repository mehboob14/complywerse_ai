'use client';

// The NCA registers (vulnerabilities, the audit plan, risks) on a page that has no assessment id: a bridge to the register lens (components/assessments/lenses).
import { Standalone } from '@/components/assessments/lenses/Standalone';
import RegisterLens from '@/components/assessments/lenses/RegisterLens';
import { REGISTERS, type RegisterKind } from '@/components/assessments/lenses/riskModel';

export default function NcaRegisterTab({ kind }: { kind: RegisterKind }) {
  const cfg = REGISTERS[kind];
  return (
    <Standalone format={cfg.format} title={`NCA ${cfg.title.toLowerCase()}`} assessmentType="cybersecurity">
      {(id, readOnly) => <RegisterLens kind={kind} assessmentId={id} readOnly={readOnly} onChanged={() => undefined} />}
    </Standalone>
  );
}
