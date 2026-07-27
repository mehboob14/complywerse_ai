const path = require('path');

/** @type {import('next').NextConfig} */
// Server-side rewrite target. Falls back to the Docker service name so
// staging deployments don't accidentally loop the proxy back through the
// public URL via NEXT_PUBLIC_BACKEND_URL. For local dev, set BACKEND_URL
// explicitly (e.g. http://127.0.0.1:4000 in .env.local).
const BACKEND_URL = (process.env.BACKEND_URL || 'http://backend:4000').replace(/\/$/, '');

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    missingSuspenseWithCSRBailout: false,
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // Increase timeout for long-running API operations
  serverRuntimeConfig: {
    apiTimeout: 900000, // 15 minutes
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/compliance/assessments/upload',
          destination: '/api/compliance/assessments/upload',
          has: [{ type: 'header', key: 'content-type', value: '(.*multipart.*)' }],
        },
        // Custom API route for policy parsing with extended timeout
        {
          source: '/api/governance/documents/:documentId/parse-policy',
          destination: '/api/governance/documents/:documentId/parse-policy',
        },
      ],
      afterFiles: [
        // Static documentation shipped in public/guide/. Next does not serve
        // directory index files from public/, so /guide would 404 while
        // /guide/index.html worked. This gives it a clean, presentable URL
        // without adding an app route (nothing here can break a page).
        { source: '/guide', destination: '/guide/index.html' },
        { source: '/guide/', destination: '/guide/index.html' },
      ],
      fallback: [
        {
          source: '/api/:path*',
          destination: `${BACKEND_URL}/:path*`,
        },
      ],
    }
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};
      config.resolve.alias['recharts'] = path.resolve(__dirname, 'src/lib/recharts-mock.js');
    }
    return config;
  },
};

module.exports = nextConfig;
