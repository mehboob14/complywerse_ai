// Whether the rows a report holds are ALL the module has. The numbers on a download, a dashboard tile or a chart describe the rows that were loaded; when those are only part of the register, the
// screen must say so (audit P-R4 / P-R5): a server-mode dataset is read in pages up to a cap and knows its total; a module's own list API answers with a fixed number of records and does NOT say
// whether it held more. Pure (rowCoverage.test.ts). The builder, the print view and the tiles can all ask it.
import { formatCount } from '../../../../lib/format.ts';

/** How many records the module list APIs send at once, by default (100) or by the limit the dataset asks for (500, 5,000). A load of exactly this many may have been cut. */
export const CLIENT_LIMITS: readonly number[] = [100, 500, 5000];

export interface Coverage {
  partial: boolean;
  /** one sentence for a notice or a toast; '' when nothing is missing */
  text: string;
  /** a few words for a tile: "first 5,000 of 5,310 rows"; '' when nothing is missing */
  short: string;
}

const COMPLETE: Coverage = { partial: false, text: '', short: '' };

/** `loaded`: the rows the load returned (before any filtering the browser does); `total`: what the server said it matched (server-mode datasets), equal to `loaded` otherwise. */
export function coverage({ serverMode, loaded, total }: { serverMode: boolean; loaded: number; total: number }): Coverage {
  if (serverMode) {
    if (total <= loaded) return COMPLETE;
    return {
      partial: true,
      text: `Only the first ${formatCount(loaded)} of ${formatCount(total)} rows were read. Narrow the report with a filter to cover them all.`,
      short: `first ${formatCount(loaded)} of ${formatCount(total)} rows`,
    };
  }
  if (!CLIENT_LIMITS.includes(loaded)) return COMPLETE;
  return {
    partial: true,
    text: `This module sends its records in a fixed batch and ${formatCount(loaded)} came back, so there may be more than the report shows.`,
    short: `may be only the first ${formatCount(loaded)} rows`,
  };
}
