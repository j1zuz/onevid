import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Onevid",
    short_name: "Onevid",
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
        // `any` (no `maskable`): así el sistema no recorta el filo del logo.
        purpose: "any",
      },
      {
        src: "/onevid-pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Versión con margen de seguridad para lanzadores que exigen maskable.
        src: "/onevid-pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
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
