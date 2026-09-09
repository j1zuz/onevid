"use client";

import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useState, type RefObject } from "react";

export function ScrollTopFade({
  scrollAreaRef,
  className,
  isScrolled: controlledIsScrolled,
}: {
  scrollAreaRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  isScrolled?: boolean;
}) {
  const [internalIsScrolled, setInternalIsScrolled] = useState(false);
  const isScrolled = controlledIsScrolled ?? internalIsScrolled;

  useEffect(() => {
    if (controlledIsScrolled !== undefined) {
      return;
    }
    const el = scrollAreaRef?.current;
    if (!el) {
      return;
    }
    let ticking = false;
    const handleScroll = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        setInternalIsScrolled(el.scrollTop > 0);
      });
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [controlledIsScrolled, scrollAreaRef]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-background to-transparent transition-opacity duration-150",
        className,
        isScrolled ? "opacity-100" : "opacity-0"
      )}
    />
  );
}
