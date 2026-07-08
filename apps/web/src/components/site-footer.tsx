import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="pb-6">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-border px-6 py-5">
        <Link
          className="text-muted-foreground text-xs hover:text-foreground"
          href="/docs"
        >
          Documentación
        </Link>
        <a
          aria-label="Disponible en Google Play"
          href="https://play.google.com/store/apps/details?id=tech.hackw.onevid"
          rel="noopener noreferrer"
          target="_blank"
        >
          {/* biome-ignore lint/performance/noImgElement: badge SVG estático local */}
          <img
            alt="Disponible en Google Play"
            className="h-10 w-auto"
            height={40}
            src="/google-play.svg"
            width={135}
          />
        </a>
      </div>
    </footer>
  );
}
