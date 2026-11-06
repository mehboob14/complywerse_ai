'use client';

/**
 * What the organisation profile still needs, as a short list that jumps to the stage (and the field) where each item is filled: the required items first,
 * then the advice behind a details control. It only arranges the server's answer (profileModel.stillNeeded).
 */
import { Check, ChevronRight, Circle } from 'lucide-react';
import { SectionCard } from '@/components/ui/ds';
import type { Group } from '@/lib/frameworkOnboarding';
import type { Needed } from './profileModel';

const ITEM = 'flex w-full items-start gap-[8px] rounded-ds-control py-[2px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring';

function Item({ item, stage, tone, onJump }: { item: Needed; stage: string; tone: 'required' | 'advice'; onJump: (item: Needed) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onJump(item)} className={`${ITEM} ${tone === 'required' ? 'text-ds-danger' : 'text-ds-fg-body'}`}>
        <Circle aria-hidden className="mt-[3px] h-[14px] w-[14px] shrink-0" strokeWidth={tone === 'required' ? 2 : 1.5} />
        <span className="min-w-0 break-words">
          {item.label}
          <span className="block text-ds-label text-ds-fg-muted">{stage}{item.hint ? ` · ${item.hint}` : ''}</span>
        </span>
      </button>
    </li>
  );
}

export default function StillNeeded({ groups, required, advice, onJump }: { groups: readonly Pick<Group, 'key' | 'label'>[]; required: Needed[]; advice: Needed[]; onJump: (item: Needed) => void }) {
  const stage = (key: string) => groups.find((g) => g.key === key)?.label ?? '';
  return (
    <SectionCard id="needed" title="Still needed" meta={required.length > 0 ? `${required.length} required` : undefined} info="Every framework's onboarding reads this profile. The required items must be filled before a framework can be approved; advised items make the answers more useful to an auditor.">
      {required.length === 0 && (
        <p className="flex items-center gap-[8px] text-ds-body text-ds-fg-body"><Check aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-success" strokeWidth={2} />Everything required is filled</p>
      )}
      {required.length > 0 && <ul className="space-y-[4px]" aria-label="Required">{required.map((n) => <Item key={n.key} item={n} stage={stage(n.stage)} tone="required" onJump={onJump} />)}</ul>}
      {advice.length > 0 && (
        <details className="group mt-[12px] border-t border-ds-border pt-[8px]">
          <summary className="flex cursor-pointer list-none items-center gap-[4px] rounded-ds-control text-ds-body font-medium text-ds-fg-body focus-visible:outline-none focus-visible:shadow-ds-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="h-[14px] w-[14px] shrink-0 group-open:rotate-90" strokeWidth={2} />
            {`Advised (${advice.length})`}
          </summary>
          <ul className="mt-[6px] space-y-[4px]" aria-label="Advised">{advice.map((n) => <Item key={n.key} item={n} stage={stage(n.stage)} tone="advice" onJump={onJump} />)}</ul>
        </details>
      )}
    </SectionCard>
  );
}
