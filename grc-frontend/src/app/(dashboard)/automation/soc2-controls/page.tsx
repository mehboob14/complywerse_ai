'use client';

// Controls Automation > Controls (the sidebar's "Common Controls"). The URL says "soc2" because the backend pins it; it lists the Secure Controls Framework's controls and the ones the
// organisation wrote, seen through its scope. The page is the facet explorer (_explorer/ControlsExplorer): live counts, quick views, List / By domain / Board, bulk owner assignment.
// Every old address keeps working: ?configure=scope, ?source=custom|scf, and /automation/scope forwards here.
import { ControlsExplorer } from './_explorer/ControlsExplorer';

export default function ControlsPage() {
  return <ControlsExplorer />;
}
