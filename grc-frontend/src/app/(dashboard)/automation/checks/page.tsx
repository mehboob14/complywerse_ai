// Automated Checks was a developer page (every check plugin, run one or all, the raw JSON of the last run) that no link opened. A control's tests, with their written procedure and their results, are on the
// control itself and the connections are on the Connections page, so the address now forwards to the Controls list (Next answers the redirect; nothing renders). Deleted later, when nobody has it bookmarked.
import { redirect } from 'next/navigation';

export default function AutomatedChecksRedirect() {
  redirect('/automation/soc2-controls');
}
