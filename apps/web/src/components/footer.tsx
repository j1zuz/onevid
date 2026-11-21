"use client";

import { Separator } from "@workspace/ui/components/separator";
import { useEffect, useState } from "react";

// El año se calcula en el navegador, no al renderizar en el servidor: el HTML
// prerenderizado del Worker salía con 1970 (el reloj del entorno de prerender
// devuelve la época), así que el footer mostraba "© 1970 onevid". En el cliente
// el año es el real y, si el usuario deja la pestaña abierta en Nochevieja, se
// corrige solo al volver a mirarla.
export default function Footer() {
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setYear(new Date().getFullYear());
    update();
    const id = window.setInterval(update, 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <footer className="shrink-0 py-6">
      <div className="flex flex-col">
        <div
          aria-hidden
          className="pointer-events-none -mb-10 h-[clamp(120px,28vh,320px)] w-full shrink-0 select-none opacity-40 max-sm:translate-y-6 sm:translate-y-0 [@media(max-height:740px)]:hidden"
        >
          <svg
            aria-hidden
            className="h-full w-full"
            overflow="visible"
            preserveAspectRatio="xMidYMid meet"
            viewBox="0 0 500 120"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Onevid</title>
            <defs>
              <linearGradient
                id="onevid-footer-grad"
                x1="0.5"
                x2="0.5"
                y1="1"
                y2="0"
              >
                <stop
                  offset="0"
                  stopColor="rgb(52,52,52)"
                  stopOpacity={1}
                />
                <stop
                  offset="1"
                  stopColor="rgb(154,154,154)"
                  stopOpacity={1}
                />
              </linearGradient>
            </defs>
            <g opacity="0.4">
              <text
                className="max-sm:[font-size:160px] sm:[font-size:90px]"
                fill="url(#onevid-footer-grad)"
                fontFamily="Arial, sans-serif"
                fontWeight="500"
                textAnchor="middle"
                x="250"
                y="75"
              >
                Onevid
              </text>
            </g>
          </svg>
        </div>
        <Separator className="w-full border-border border-t border-dashed bg-transparent" />
        <div className="mt-3 flex w-full min-w-0 flex-nowrap items-center justify-between gap-2 whitespace-nowrap">
          <span
            className="shrink-0 text-muted-foreground text-xs"
            suppressHydrationWarning
          >
            © {year ? `${year} ` : ""}Onevid
          </span>
          <a
            className="shrink-0 text-muted-foreground text-xs transition-colors hover:text-foreground"
            href="https://deepwiki.com/j1zuz/onevid"
            rel="noopener noreferrer"
            target="_blank"
          >
            Documentación
          </a>
        </div>
      </div>
    </footer>
  );
}
