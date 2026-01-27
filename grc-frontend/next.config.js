/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/compliance/assessments/upload',
          destination: '/api/compliance/assessments/upload',
          has: [{ type: 'header', key: 'content-type', value: '(.*multipart.*)' }],
        },
      ],
      afterFiles: [],
      fallback: [
        {
          source: '/api/:path*',
          destination: 'http://localhost:8000/grc/:path*',
        },
      ],
    }
  },
}

module.exports = nextConfig
