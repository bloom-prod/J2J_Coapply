/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    // firebase-admin uses Node APIs; keep it external to the server bundle.
    serverComponentsExternalPackages: ["firebase-admin"],
  },
};

export default nextConfig;
