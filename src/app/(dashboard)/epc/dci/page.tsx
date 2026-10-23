'use client';

import { Register } from '@/components/Register';

/**
 * Design control issue list.
 *
 * Transmittal register: document, discipline, revision, purpose, review code,
 * issue and due back dates. The register engine owns search, form and validation.
 */
export default function EpcDciPage() {
  return (
    <Register
      typeKey="dci_documents"
      title="Design control issue"
      description="Transmittal register with review code, issue date and due back date per document."
    />
  );
}
