'use client';

// Risk Management > Risk Register. The sidebar's "Risk Register" opens the register itself (it used to open a dashboard, with the register behind a dropdown): the facet explorer, with the
// old dashboard folded in as its Insights view. /erm/risks/dashboard and /erm/risks/list forward here, with their old parameters.
import { RiskRegister } from './_register/RiskRegister';

export default function RiskRegisterPage() {
  return <RiskRegister />;
}
