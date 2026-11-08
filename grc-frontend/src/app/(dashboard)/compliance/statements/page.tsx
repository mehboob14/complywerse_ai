'use client';

import { useAddressState } from '@/components/ui/ds';
import { StatementsRegister } from './_register/StatementsRegister';
import { STATEMENTS_SCHEMA } from './_register/statementAddress';

/** Compliance > Statements: the policy statements as a facet register (./_register), its state kept in the address. */
export default function PolicyStatementsPage() {
  const [address, setAddress] = useAddressState(STATEMENTS_SCHEMA);
  return <StatementsRegister address={address} setAddress={setAddress} />;
}
