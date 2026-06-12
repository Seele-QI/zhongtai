/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Exclude Remotion native packages from Turbopack bundling
  serverExternalPackages: [
    "@remotion/bundler",
    "@remotion/renderer",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
}

export default nextConfig
