/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // firebase-admin pulls in optional native/dynamic requires that the bundler
  // should leave alone — keep it external on the server runtime.
  serverExternalPackages: ['firebase-admin', 'jspdf', 'jspdf-autotable'],
  eslint: {
    // Lint is run explicitly via `npm run lint`; don't fail production builds on it.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
