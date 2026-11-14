import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "onevid",
    short_name: "onevid",
    description: "Reproductor de video",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["entertainment", "video"],
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
    shortcuts: [
      {
        name: "Descargas sin conexión",
        short_name: "Descargas",
        description: "Películas y episodios guardados en este dispositivo",
        url: "/offline",
        icons: [
          {
            src: "/onevid-pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
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
