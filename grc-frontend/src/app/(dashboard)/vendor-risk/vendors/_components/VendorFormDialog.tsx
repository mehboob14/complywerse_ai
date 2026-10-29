'use client';

// The add / edit vendor dialog. Owner: B2. (Stub; the build fills it.)
export type VendorFormDialogProps = {
  open: boolean;
  mode: 'add' | 'edit';
  /** The vendor being edited (mode 'edit'). */
  vendor?: Record<string, any>;
  onClose: () => void;
  /** Called with the saved vendor (as the API returns it) after a successful save. */
  onSaved?: (vendor: Record<string, any>) => void;
};

export default function VendorFormDialog(_props: VendorFormDialogProps) {
  return null;
}
