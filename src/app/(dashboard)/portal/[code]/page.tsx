import { notFound } from 'next/navigation';

import PortalClient from './PortalClient';

/**
 * Client portal — per-client project view.
 *
 * Server component that awaits the async `params` (Next.js 15 pattern),
 * then hands off to the client component for all data fetching and render.
 */
export default async function PortalClientPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!code) notFound();
  return <PortalClient code={code} />;
}
