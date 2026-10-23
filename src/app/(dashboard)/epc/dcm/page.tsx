'use client';

import { Register } from '@/components/Register';

/**
 * Document control matrix.
 *
 * Per document class: which parties review and approve, and the turnaround
 * time. Editing is permission-gated rather than locked, so an operator with
 * dms:update can still maintain a class that the admin UI would otherwise
 * strand in a stale state.
 */
export default function EpcDcmPage() {
  return (
    <Register
      typeKey="dcm_classes"
      title="Document control matrix"
      description="Review and approval routing per document class, with turnaround time."
    />
  );
}
