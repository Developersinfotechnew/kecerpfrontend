import { notFound } from 'next/navigation';

import RegisterBody from './RegisterBody';

/**
 * Generic register screen — server wrapper.
 *
 * Awaits the async `params` (Next.js 15 pattern), then hands the `key` to the
 * client component which does all data fetching and rendering.
 */
export default async function RegisterPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  if (!key) notFound();
  return <RegisterBody key={key} />;
}
