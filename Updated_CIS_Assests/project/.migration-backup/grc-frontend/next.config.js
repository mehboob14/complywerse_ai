const path = require('path');

/** @type {import('next').NextConfig} */
const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

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
      afterFiles: [],
      fallback: [
        {
          source: '/api/:path*',
          destination: `${BACKEND_URL}/grc/:path*`,
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
