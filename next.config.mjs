/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
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
      {
        // Force a fresh load for every visitor: never cache the app's HTML, so
        // a deploy always shows up on the next page load (no stale shell).
        source: "/((?!api|_next|sw\\.js|favicon|icon-|manifest\\.webmanifest|android-chrome).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
