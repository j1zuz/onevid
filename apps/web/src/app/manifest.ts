import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "onevid",
    short_name: "onevid",
    description: "Reproductor de video",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: "/onevid-pwa-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/onevid-pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    screenshots: [
      {
        src: "/opengraph.jpg",
        sizes: "1200x675",
        type: "image/jpeg",
        label: "onevid — Reproductor de video",
      },
    ],
  };
}
