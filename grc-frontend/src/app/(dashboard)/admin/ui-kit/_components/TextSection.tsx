'use client';

// ClampedText, ChipList, Fact and FactList, TitleLink and linkClasses, CardLink: the small pieces every record page rebuilt by hand in the first wave (long text with
// "Show more", related records as "first two and +N", label-over-value facts, a title that is a 24px link, a card that is one link). Static fixtures only: nothing
// here calls the API.
import Link from 'next/link';
import { CardLink, ChipList, ClampedText, Fact, FactList, PersonChip, TitleLink, linkClasses, type ChipListItem } from '@/components/ui';
import { GuideSection, Grid, Spec, Specimen } from './Guide';

const FRAME = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
const NOTE = 'text-ds-label text-ds-fg-muted';
const LONG = 'Annual review of the information security management system policy, every standard and every procedure owned by the technology risk office of the retail banking group and its subsidiaries';
const PARAGRAPHS = 'The organisation shall establish, document, implement and maintain an information security management system and continually improve its effectiveness, in accordance with the requirements of this standard.\n\nThe scope shall take account of the external and internal issues, the requirements of interested parties, and the interfaces and dependencies between activities performed by the organisation and those performed by other organisations.\n\nThe documented information required shall be controlled so that it is available and suitable for use, where and when it is needed, and adequately protected.';
const ARABIC = 'يجب على المؤسسة أن تضع وتوثق وتنفذ وتحافظ على نظام لإدارة أمن المعلومات وأن تحسن فعاليته باستمرار وفقاً لمتطلبات هذا المعيار، وأن تأخذ في الاعتبار القضايا الداخلية والخارجية ومتطلبات الأطراف المعنية.';
const UNBROKEN = `Reference-${'0123456789'.repeat(12)}`;
const FRAMEWORKS = ['ISO 27001', 'SOC 2 Type II', 'PCI DSS 4.0', 'NCA ECC', 'SAMA CSF', 'PDPL', 'ISO 22301', 'ISO 27701', 'NIST CSF 2.0', 'CIS Controls v8', 'UAE IA', 'CFSB baseline'];
const linked = (names: string[]): ChipListItem[] => names.map((label) => ({ label, href: '#text' }));

function ClampDemo() {
  return (
    <div className="space-y-[16px]">
      <Grid cols={2}>
        <Specimen label="Three lines (the default): it is cut, so Show more is drawn; Show less shuts it again, from the keyboard too">
          <div className={FRAME}><ClampedText text={PARAGRAPHS} /></div>
        </Specimen>
        <Specimen label="A short text fits: no button, no cut">
          <div className={FRAME}><ClampedText text="Reviewed by the Head of Technology Risk every March." /></div>
        </Specimen>
        <Specimen label="lines={5} with paragraph breaks kept">
          <div className={FRAME}><ClampedText text={PARAGRAPHS} lines={5} /></div>
        </Specimen>
        <Specimen label="Measured, not counted: the same text in a 200 px box is cut; in a wide box (above) it may fit">
          <div className={`${FRAME} max-w-[200px]`}><ClampedText text="The register is reviewed every quarter by the committee." lines={2} /></div>
        </Specimen>
        <Specimen label="Read in its own direction: an Arabic text sits to the right and is cut at one line; the button stays at the left edge of the box">
          <div className={FRAME}><ClampedText text={ARABIC} lines={1} /></div>
        </Specimen>
        <Specimen label="A 130-character word with no break wraps instead of widening the box; and none at all is the dash">
          <div className={`${FRAME} max-w-[280px] space-y-[8px]`}><ClampedText text={UNBROKEN} lines={2} /><ClampedText text={null} /></div>
        </Specimen>
      </Grid>
    </div>
  );
}

function ChipsDemo() {
  return (
    <div className="space-y-[16px]">
      <Grid cols={2}>
        <Specimen label="Five frameworks as names: the first two and &quot;+3&quot;; it opens all five (no search under eight)">
          <div className={FRAME}><ChipList label="frameworks" items={FRAMEWORKS.slice(0, 5)} /></div>
        </Specimen>
        <Specimen label="Twelve, as links: &quot;+10&quot; opens a dialog with a search box and the links; Tab stays inside it, Escape gives focus back">
          <div className={FRAME}><ChipList label="frameworks" items={linked(FRAMEWORKS)} /></div>
        </Specimen>
        <Specimen label="Two or fewer: no +N. One: a single chip. None: nothing is drawn (not even an empty list)">
          <div className={`${FRAME} space-y-[8px]`}>
            <ChipList label="owners" items={['Olivia Owner', 'Rana Reviewer']} />
            <ChipList label="owners" items={['Olivia Owner']} />
            <ChipList label="owners" items={[]} />
            <p className={NOTE}>(end of the specimen)</p>
          </div>
        </Specimen>
        <Specimen label="Three: &quot;+1&quot; is a count like any other (PersonStack does the same)">
          <div className={FRAME}><ChipList label="assets" items={['Core banking', 'Payments hub', 'Data warehouse']} /></div>
        </Specimen>
        <Specimen label="shown={3}, searchFrom={4}: the first three, and the search box from four items">
          <div className={FRAME}><ChipList label="frameworks" shown={3} searchFrom={4} items={FRAMEWORKS.slice(0, 6)} /></div>
        </Specimen>
        <Specimen label="Long names in a 300 px box: a chip is cut with its whole name as a tooltip, never wider than its row; the same names in the full list wrap">
          <div className={`${FRAME} max-w-[300px]`}><ChipList label="frameworks" items={[LONG, UNBROKEN, 'ISO 27001', 'SOC 2']} /></div>
        </Specimen>
      </Grid>
    </div>
  );
}

function FactsDemo() {
  return (
    <div className="space-y-[16px]">
      <Specimen label="plain: a label over its value in as many columns as fit; a person, a missing value (the dash), a value the person can set (Not set), a long value, a word with no break">
        <div className={FRAME}>
          <FactList>
            <Fact label="Owner"><PersonChip name="Olivia Owner" /></Fact>
            <Fact label="Status">In force</Fact>
            <Fact label="Next review">12 Nov 2026</Fact>
            <Fact label="Approved by">{null}</Fact>
            <Fact label="Review cycle" empty="Not set">{null}</Fact>
            <Fact label="Classification">Internal</Fact>
            <Fact label="Scope">{LONG}</Fact>
            <Fact label="Reference">{UNBROKEN}</Fact>
          </FactList>
        </div>
      </Specimen>
      <Grid cols={2}>
        <Specimen label="boxed: each fact in its own box (a band of figures); min={120}">
          <FactList variant="boxed" min={120}>
            <Fact label="Controls">1,247</Fact>
            <Fact label="Evidence">312</Fact>
            <Fact label="Overdue">0</Fact>
            <Fact label="Owner">{null}</Fact>
          </FactList>
        </Specimen>
        <Specimen label="One column in a 220 px box: the grid never makes a column wider than the box">
          <div className={`${FRAME} max-w-[220px]`}>
            <FactList><Fact label="Owner">Olivia Owner</Fact><Fact label="Status">In force</Fact><Fact label="Scope">{LONG}</Fact></FactList>
          </div>
        </Specimen>
      </Grid>
    </div>
  );
}

function LinksDemo() {
  return (
    <div className="space-y-[16px]">
      <Grid cols={2}>
        <Specimen label="TitleLink: a name that is a link, 24 px tall (44 px on a phone), no layout shift; Tab to see the ring on the link itself">
          <div className={`${FRAME} space-y-[8px]`}>
            <TitleLink href="#text" title="Business continuity plan: payments platform" />
            <TitleLink href="#text" title="Failover drill 2026-Q3" tone="text" />
            <TitleLink href="#text" title="Annual restore test (muted, a 12 px line)" tone="muted" size="label" />
          </div>
        </Specimen>
        <Specimen label="A long title is cut at two lines; the whole of it is the tooltip only then. lines={1} cuts at one">
          <div className={`${FRAME} max-w-[360px] space-y-[8px]`}>
            <TitleLink href="#text" title={LONG} />
            <TitleLink href="#text" title={LONG} lines={1} />
            <TitleLink href="#text" title={UNBROKEN} />
          </div>
        </Specimen>
        <Specimen label="linkClasses on a next/link inside a sentence: the same target and colours, the line does not move">
          <div className={FRAME}>
            <p className="text-ds-body text-ds-fg-body">The plan is reviewed by <Link href="#text" className={linkClasses({ tone: 'text' })}>the technology risk office</Link> every March, and <Link href="#text" className={linkClasses({ tone: 'text' })}>its drills</Link> every quarter.</p>
            <p className="mt-[6px] text-ds-label text-ds-fg-muted">Last drill: <Link href="#text" className={linkClasses({ tone: 'muted', size: 'label' })}>Failover drill 2026-Q3</Link> · <Link href="#text" className={linkClasses({ tone: 'text', size: 'label' })}>Open the plan</Link></p>
          </div>
        </Specimen>
      </Grid>
    </div>
  );
}

function CardsDemo() {
  return (
    <Grid cols={3}>
      <Specimen label="The card IS the link: one tab stop, the ring on the card, a hover that says it presses">
        <CardLink href="#text">
          <h3 className="!text-ds-section !text-ds-fg">Documents</h3>
          <p className="mt-[2px] text-ds-body text-ds-fg-muted">41 in force, 7 in review, 3 expired</p>
        </CardLink>
      </Specimen>
      <Specimen label="padded={false}: a card that brings its own edge-to-edge parts">
        <CardLink href="#text" padded={false}>
          <p className="border-b border-ds-border px-[16px] py-[8px] text-ds-label text-ds-fg-muted">An edge-to-edge header</p>
          <p className="px-[16px] py-[12px] text-ds-body text-ds-fg-body">{LONG}</p>
        </CardLink>
      </Specimen>
      <Specimen label="A long name and a word with no break wrap inside the card; nothing widens it">
        <CardLink href="#text">
          <h3 className="break-words !text-ds-section !text-ds-fg [overflow-wrap:anywhere]">{UNBROKEN}</h3>
          <p className="mt-[2px] break-words text-ds-body text-ds-fg-muted">{LONG}</p>
        </CardLink>
      </Specimen>
    </Grid>
  );
}

export function TextSection() {
  return (
    <GuideSection id="text" title="Text, facts and links" lead="The small pieces every record page rebuilt by hand in the first wave: long text that opens, related records as the first two and +N, a label over its value, a title that is a link with a real target, and a card that is one link.">
      <Spec name="ClampedText"><ClampDemo /></Spec>
      <Spec name="ChipList"><ChipsDemo /></Spec>
      <Spec name="Fact"><FactsDemo /></Spec>
      <Spec name="TitleLink"><LinksDemo /></Spec>
      <Spec name="CardLink"><CardsDemo /></Spec>
    </GuideSection>
  );
}
