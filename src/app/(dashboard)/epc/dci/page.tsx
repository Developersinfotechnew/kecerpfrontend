'use client';

import { Register } from '@/components/Register';

/**
 * Document Control Index (KEC spec, Critical).
 *
 * Every document of the project: meta-data and control — document no., type,
 * discipline, revision, who created / reviewed / approved, when formed, to
 * whom issued, current status, FAT / SAT / as-built / SOP / O&M deliverables,
 * transmittal reference. Opening a row's approval runs the dci_approval
 * chain: document control review, PM release, client review code A/B/C/D;
 * the transmittal log row follows automatically. The register engine owns
 * search, form and validation.
 */
export default function EpcDciPage() {
  return (
    <Register
      typeKey="dci_documents"
      title="Document control index"
      description="Every project document — master, meta-data and control. Approval chain: document control, PM, client review code."
    />
  );
}
