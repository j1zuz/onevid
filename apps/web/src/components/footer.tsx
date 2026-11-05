import { Separator } from "@workspace/ui/components/separator";

// Calculado una sola vez, al cargar el módulo (no en cada render): así no
// cuenta como un valor "inestable" durante el prerender. Se actualiza en cada
// build/deploy.
const currentYear = new Date().getFullYear();

export default function Footer() {
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
            <title>onevid</title>
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
                onevid
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
            © {currentYear} onevid
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
