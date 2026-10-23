'use client';

import { TypeDesigner } from '@/components/TypeDesigner';
import { useSession } from '@/app/session';
import { PageHead } from '@/components/ui';

/**
 * Register designer.
 *
 * The place Management and Admin add a register. Everything else — the table,
 * the form, the permissions, the audit trail — comes from the record engine and
 * requires no further work.
 *
 * Read-only when the caller lacks admin:create: the layout stays visible so a
 * manager can see what an admin does here, but the controls refuse input.
 */
export default function RegisterDesignerPage() {
  const { can } = useSession();
  const canCreate = can('admin:create');

  return (
    <>
      <PageHead
        title="Register designer"
        description="Define a new register. Choose its permission module and add fields, then save. The register is live immediately — no deploy, no new page."
      />
      <TypeDesigner canCreate={canCreate} />
    </>
  );
}
