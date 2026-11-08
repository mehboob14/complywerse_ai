// The address of an assessment's workspace: which risk's drawer is open (?risk=<assessed risk>). The tab (?tab=) is useTabParam's. Defined once, outside any component.
import { integer } from '../../../../../../lib/addressState.ts';

export const riskAddress = { risk: integer(0, { min: 1 }) };
