'use client';

// The drawer that opens from a framework row: the clause, how it matched, the text of the clause and of the statements that cover it, and (for people who may
// link) Link / Unlink. Read-only otherwise. Same content as before on the kit's tokens: text 12px and up, headings that are headings, the Link button the
// kit's. The row it shows is the LIVE one (the caller passes it again after a link changes), so the button never says "Link" for a control that is linked.
import type { ReactNode } from 'react';
import { Link2, Unlink } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, Notice, StatusPill } from '@/components/ui/ds';
import { statusLabel } from '@/lib/format';
import type { RecommendedControl, StatementTextMap } from './_types';
import { matchPct, upperCode } from './mappingsModel';

const TEXT_BOX = 'whitespace-pre-wrap break-words rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[14px] py-[12px] text-ds-body text-ds-fg-body';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-ds-border pt-[16px]">
      <h3 className="mb-[8px] !text-ds-label !text-ds-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

export interface MappingDetailProps {
  /** the row to show; null: the drawer is shut */
  row: RecommendedControl | null;
  onClose: () => void;
  canLink: boolean;
  /** this row's link is being changed */
  pending: boolean;
  onToggle: (row: RecommendedControl) => void;
  statementText: StatementTextMap;
  /** the full statement text could not be read: the short versions are shown, and it says so */
  statementsFailed?: boolean;
  onRetryStatements?: () => void;
}

export function MappingDetail({ row, onClose, canLink, pending, onToggle, statementText, statementsFailed, onRetryStatements }: MappingDetailProps) {
  const gap = row?.source === 'gap';
  return (
    <RightSlidePanel isOpen={!!row} onClose={onClose} title="Mapping detail" width="w-full max-w-[560px]">
      {row && (
        <div className="flex flex-col gap-[16px]">
          {/* code, framework, title: stacked so the labels never run together */}
          <div>
            <div className="flex flex-wrap items-start justify-between gap-[12px]">
              <div className="min-w-0 flex-1">
                <p className="break-words font-mono text-ds-title text-ds-fg">{upperCode(row.clause_reference || row.control_code) || '—'}</p>
                {row.framework_name && <p className="mt-[4px] break-words text-ds-body font-[600] text-ds-fg-muted">{row.framework_name}</p>}
                {row.control_title && <p className="mt-[6px] break-words text-ds-body text-ds-fg">{row.control_title}</p>}
              </div>
              {row.is_linked && <StatusPill tone="success" label="Linked" />}
            </div>

            {/* how it matched: each a word, side by side */}
            <div className="mt-[12px] flex flex-wrap gap-[8px]">
              {matchPct(row) !== null && <StatusPill tone="neutral" label={`${matchPct(row)}% match`} />}
              {gap && <StatusPill tone="progress" label="Gap recommendation" />}
              {row.compliance_status && <StatusPill tone="warning" label={statusLabel(row.compliance_status)} />}
              {row.risk_severity && <StatusPill tone="neutral" label={`${statusLabel(row.risk_severity)} risk`} />}
              {/* (the kind of control, parsed or normalized, is left out on purpose, as on the rows) */}
              {row.coverage_type && !gap && <StatusPill tone="neutral" label={statusLabel(row.coverage_type)} />}
              {row.domain && <StatusPill tone="neutral" label={row.domain} />}
            </div>

            {canLink && !(gap && row.is_linked) && (
              <div className="mt-[12px]">
                <Button
                  loading={pending}
                  leftIcon={row.is_linked ? <Unlink aria-hidden /> : <Link2 aria-hidden />}
                  onClick={() => onToggle(row)}
                  aria-label={`${row.is_linked ? 'Unlink' : 'Link'} ${upperCode(row.clause_reference || row.control_code) || 'this control'}`}
                >
                  {row.is_linked ? 'Unlink' : 'Link'}
                </Button>
              </div>
            )}
          </div>

          {row.rationale && <Section title="Why it matched"><p className={TEXT_BOX}>{row.rationale}</p></Section>}
          {row.description && <Section title={gap ? 'Clause / control text' : 'Clause text'}><p className={TEXT_BOX}>{row.description}</p></Section>}
          {gap && row.gap_description && row.gap_description !== row.rationale && <Section title="Gap description"><p className={TEXT_BOX}>{row.gap_description}</p></Section>}
          {gap && row.missing_requirement && <Section title="Missing requirement"><p className={TEXT_BOX}>{row.missing_requirement}</p></Section>}
          {gap && row.remediation && <Section title="Remediation"><p className={TEXT_BOX}>{row.remediation}</p></Section>}

          {!gap && (
            <Section title={`Covered by ${row.statement_count} statement${row.statement_count === 1 ? '' : 's'}`}>
              {statementsFailed && (
                <Notice tone="warning" title="The full statement text could not be loaded" action={onRetryStatements && <Button onClick={onRetryStatements}>Retry</Button>} className="mb-[8px]">
                  The short versions are shown.
                </Notice>
              )}
              <div className="flex flex-col gap-[8px]">
                {row.statements.length === 0 ? (
                  <p className="text-ds-body text-ds-fg-muted">No detail</p>
                ) : (
                  row.statements.map((s) => {
                    const full = statementText.get(s.id);
                    return (
                      <div key={s.id} className="rounded-ds-card border border-ds-border bg-ds-surface px-[14px] py-[12px]">
                        {(s.statement_code || full?.code) && (
                          <p className="mb-[4px] break-words font-mono text-ds-label font-[600] uppercase text-ds-fg-muted">{s.statement_code || full?.code}</p>
                        )}
                        <p className="break-words text-ds-body text-ds-fg-body">{full?.text || s.snippet || '—'}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </Section>
          )}

          {gap && !row.description && !row.gap_description && !row.remediation && !row.rationale && (
            <Section title="Detail"><p className="text-ds-body text-ds-fg-muted">No more detail</p></Section>
          )}
        </div>
      )}
    </RightSlidePanel>
  );
}
