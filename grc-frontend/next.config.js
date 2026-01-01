/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/grc/:path*',
      },
    ]
  },
}

module.exports = nextConfig
