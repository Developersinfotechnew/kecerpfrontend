import { notFound } from 'next/navigation';

/**
 * Catch-all for module routes that have no page yet.
 *
 * Returns a real 404 rather than redirecting to `/`, which would loop. A
 * module becomes live the moment a page is added under this group, so the
 * build-out is one folder at a time.
 *
 * The API enforces permissions independently of this file. Hiding the link in
 * the sidebar is a courtesy; a direct request still fails at the API.
 */
export default function ModulePlaceholder() {
  notFound();
}
