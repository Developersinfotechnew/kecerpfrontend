import { redirect } from 'next/navigation';

export default function Home() {
  // The dashboard route group applies the auth check and sends unauthenticated
  // users to /login. Landing here just forwards.
  redirect('/dashboard');
}
