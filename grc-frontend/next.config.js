/** @type {import('next').NextConfig} */
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
          destination: 'http://127.0.0.1:4000/grc/:path*',
        },
      ],
    }
  },
}

module.exports = nextConfig
