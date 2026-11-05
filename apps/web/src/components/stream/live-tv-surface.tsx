"use client";

import { useRef, type ComponentProps } from "react";
import { OneVidHeader } from "./onevid-header";
import { OneVidLiveTv } from "./onevid-live-tv";
import { LiveTvSearchProvider } from "./live-tv-search";
import { ScrollTopFade } from "./scroll-top-fade";

type HeaderProps = Omit<ComponentProps<typeof OneVidHeader>, "surface">;

/** Live TV comparte el buscador y la estructura de scroll de Inicio/Descubrir. */
export function LiveTvSurface({ headerProps }: { headerProps: HeaderProps }) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  return (
    <LiveTvSearchProvider>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <OneVidHeader {...headerProps} surface="live" />
        <div className="relative min-h-0 flex-1">
          <ScrollTopFade scrollAreaRef={scrollAreaRef} />
          <div
            className="no-scrollbar flex h-full flex-col gap-8 overflow-y-auto py-4"
            ref={scrollAreaRef}
          >
            <OneVidLiveTv />
          </div>
        </div>
      </div>
    </LiveTvSearchProvider>
  );
}
