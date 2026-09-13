import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Embed one timestamp for the whole build so server and client render the same value.
  env: {
    NEXT_PUBLIC_BUILD_TIMESTAMP: new Date().toISOString(),
  },
  async headers() {
    return [
      {
        // The service worker must be served from the root scope and never cached hard.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
