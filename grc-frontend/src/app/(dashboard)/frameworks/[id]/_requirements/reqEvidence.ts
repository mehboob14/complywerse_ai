// What a requirement asks for as evidence. The seed data names an ask `name`, an older shape `title`; the types say `title`. One reader for both, so a list never shows a blank.
import type { EvidenceRequirement } from '../../../../../types/index.ts';

type Ask = Partial<EvidenceRequirement> & { name?: string };

export function evidenceAskName(a: Ask): string {
  return (a.name ?? a.title ?? '').trim() || 'Evidence';
}
