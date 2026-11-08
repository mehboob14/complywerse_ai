'use client';

// The control workspace (`[code]` is the SCF id, "IAC-06", or the code of a control the organisation wrote). The page is only the address; everything it draws is in _workspace/.
import { useParams } from 'next/navigation';
import { ControlWorkspace } from './_workspace/ControlWorkspace';

export default function ControlPage() {
  const params = useParams();
  return <ControlWorkspace code={decodeURIComponent(String(params?.code || ''))} />;
}
