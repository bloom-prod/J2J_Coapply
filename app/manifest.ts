import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bloom Tracker",
    short_name: "Bloom",
    description: "Your job search garden",
    start_url: "/",
    display: "standalone",
    background_color: "#FDFAF7",
    theme_color: "#D4537E",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
