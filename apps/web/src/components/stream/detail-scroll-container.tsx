"use client";

import { useState, type ReactNode } from "react";
import { ScrollTopFade } from "@/components/stream/scroll-top-fade";

export function DetailScrollContainer({
  children,
}: {
  children: ReactNode;
}) {
  const [isScrolled, setIsScrolled] = useState(false);

  return (
    <div className="relative flex h-0 min-h-0 flex-1 flex-col">
      <ScrollTopFade className="z-20" isScrolled={isScrolled} />
      <div
        className="no-scrollbar flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto py-4"
        data-dpad-poster-grid
        onScroll={(event) => setIsScrolled(event.currentTarget.scrollTop > 0)}
      >
        {children}
      </div>
    </div>
  );
}
