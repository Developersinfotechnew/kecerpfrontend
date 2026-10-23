'use client';

import { Register } from '@/components/Register';

/**
 * Issues and risks.
 *
 * Backed by the risk register. The previous static table listed risks inline;
 * those rows now live in the seeded `risk_register` type and are editable by
 * admin and management without a deploy.
 */
export default function EpcIssuesPage() {
  return (
    <Register
      typeKey="risk_register"
      title="Issues & risks"
      description="Open risks with owner, likelihood, impact and mitigation. Add, edit and close items here."
    />
  );
}
