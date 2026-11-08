'use client';

// Risk Management > RCSA > Templates: the library of what a campaign is built from. Two kinds sit behind one switch, kept in the address (?kind=questionnaires | registers):
//   Questionnaires  the question templates assessors answer in a campaign (provided by the platform or made by the organisation)
//   Registers       the organisation's own Excel risk registers, kept as searchable lists of items (the old "Custom Templates")
// The page draws the head (title, the RCSA sections, the kind switch); each kind is a register on the facet explorer and hands the head its count and its buttons.
import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { SegmentedControl, useAddressState } from '@/components/ui/ds';
import { oneOf } from '@/lib/addressState';
import { RcsaNav } from '../_parts/RcsaNav';
import { QuestionnaireLibrary } from './_parts/QuestionnaireLibrary';
import { RegisterLibrary } from './_parts/RegisterLibrary';
import type { LibraryHeadArgs } from './_parts/libraryShared';

const KINDS = ['questionnaires', 'registers'] as const;
type Kind = (typeof KINDS)[number];
const SCHEMA = { kind: oneOf(KINDS, 'questionnaires') };

const INFO = 'Questionnaires are the questions assessors answer in a campaign. Registers are your own Excel risk registers, kept as lists you can search and give owners.';

function Head({ kind, meta, actions, onKind }: LibraryHeadArgs & { kind: Kind; onKind: (kind: Kind) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      <PageHeader variant="page" title="RCSA Templates" info={INFO} meta={meta} actions={actions} />
      <RcsaNav active="templates" />
      <SegmentedControl
        label="Kind of template"
        name="rcsa-template-kind"
        value={kind}
        onChange={onKind}
        options={[{ value: 'questionnaires', label: 'Questionnaires' }, { value: 'registers', label: 'Registers' }]}
        className="self-start"
      />
    </div>
  );
}

function Library() {
  const router = useRouter();
  const [{ kind }] = useAddressState(SCHEMA);
  // a clean address for the other kind: the search, filters and open record of this one mean nothing there
  const pick = (next: Kind) => router.replace(next === 'questionnaires' ? '/erm/rcsa/templates' : `/erm/rcsa/templates?kind=${next}`, { scroll: false });
  const head = (args: LibraryHeadArgs) => <Head {...args} kind={kind} onKind={pick} />;
  return kind === 'registers' ? <RegisterLibrary key="registers" head={head} /> : <QuestionnaireLibrary key="questionnaires" head={head} />;
}

export default function RcsaTemplatesPage() {
  return <Suspense fallback={null}><Library /></Suspense>;
}
