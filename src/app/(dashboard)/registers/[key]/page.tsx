import { notFound } from 'next/navigation';

import RegisterBody from './RegisterBody';

/**
 * Generic register screen — server wrapper.
 *
 * Awaits the async `params` (Next.js 15 pattern) and returns notFound() for
 * an empty key. The client child reads the key itself via useParams().
 */
export default async function RegisterPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  if (!key) notFound();
  return <RegisterBody />;
}
