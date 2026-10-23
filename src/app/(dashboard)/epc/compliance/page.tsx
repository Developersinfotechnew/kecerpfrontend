'use client';

import { Register } from '@/components/Register';

/**
 * Compliance and approvals.
 *
 * Thin wrapper. The register engine owns the table, the search, the form and
 * the validation; this file names which register to show. Every other register
 * screen is the same two lines with a different key.
 */
export default function EpcCompliancePage() {
  return (
    <Register
      typeKey="compliance_register"
      title="Compliance & approvals"
      description="Licences, NOCs and statutory approvals for this plant, with owner, evidence and renewal reminders."
    />
  );
}
