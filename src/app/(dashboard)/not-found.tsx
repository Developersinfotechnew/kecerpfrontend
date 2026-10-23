import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold text-slate-900">Page not built yet</h1>
      <p className="mt-2 text-sm text-slate-600">
        This module has no page yet. The API and its permissions already exist.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
