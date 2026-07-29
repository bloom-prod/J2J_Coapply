/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    // firebase-admin uses Node APIs; keep it external to the server bundle.
    serverComponentsExternalPackages: ["firebase-admin"],
  },
  // Ensure the service worker and generated icons are served with correct MIME types.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
