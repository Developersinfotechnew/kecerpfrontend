/** @type {import('next').NextConfig} */
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,

  // The backend origin never reaches the browser. Browsers call same-origin
  // /api/* and Next proxies those to Express, so the API URL stays server-side.
  // This is also why the refresh cookie works: the browser sees one origin.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
