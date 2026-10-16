"use client";

import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useId, useRef } from "react";
import { buildDefs, buildFrame, buildIris, GAZE_PX, PUPIL_MAX, PUPIL_MIN, VIEW } from "./eye-art.mjs";
import { createEyeMotion } from "./eye-model";

export interface MysticEyeProps {
  className?: string;
  /** Follow the pointer. When false the eye only wanders on its own. Default true. */
  follow?: boolean;
  /** Accessible label. Omit to keep the eye decorative (aria-hidden). */
  label?: string;
}

const START_PUPIL = (PUPIL_MIN + PUPIL_MAX) / 2;

/**
 * An ornate, front-facing mystic eye drawn as ink line-art: a realistic violet
 * iris (radial fibres, collarette, limbal ring, pupil, catchlight) inside almond
 * lids with lashes, wreathed in flame tongues with rhombus ornaments. The iris
 * tracks the pointer and the pupil dilates; it wanders on its own when idle and
 * holds still under reduced motion. Pure SVG — renders on the server, hydrates
 * without a flash, and scales to any size via `className`.
 */
export function MysticEye({ className, follow = true, label }: MysticEyeProps) {
  const uid = useId().replace(/:/g, "");
  const irisRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const irisEl = irisRef.current;
    if (!irisEl) return;

    const motion = createEyeMotion({ follow });
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let raf = 0;
    let last = 0;
    let visible = false;
    let builtPupil = START_PUPIL;
    let glowEl = irisEl.querySelector<SVGCircleElement>("[data-glow]");

    const tick = (now: number) => {
      const calm = reduce.matches;
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      const u = motion.step(dt, calm);

      // Gaze: slide the iris toward the pointer (screen y points down); the clip
      // keeps it inside the lids.
      const dx = (u.uGaze[0] * GAZE_PX).toFixed(2);
      const dy = (-u.uGaze[1] * GAZE_PX * 0.6).toFixed(2);
      irisEl.setAttribute("transform", `translate(${dx} ${dy})`);

      // Dilation: redraw the iris only when the pupil really moved.
      const pupil = PUPIL_MIN + u.uDilate * (PUPIL_MAX - PUPIL_MIN);
      if (Math.abs(pupil - builtPupil) > 0.5) {
        builtPupil = pupil;
        irisEl.innerHTML = buildIris(pupil, uid);
        glowEl = irisEl.querySelector<SVGCircleElement>("[data-glow]");
      }

      // Mystic breath: pulse the glow.
      if (glowEl) glowEl.style.opacity = (0.6 + 0.4 * u.uGlow).toFixed(3);

      raf = calm || !visible ? 0 : requestAnimationFrame(tick);
    };

    const start = () => {
      if (!raf && visible) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const box = irisEl.ownerSVGElement?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      const nx = (e.clientX - (box.left + box.width / 2)) / (box.width / 2);
      const ny = -(e.clientY - (box.top + box.height / 2)) / (box.height / 2);
      motion.pointer(nx, ny);
      start();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) start();
      },
      { rootMargin: "120px 0px" }
    );
    observer.observe(irisEl);
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [follow, uid]);

  return (
    <div
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn("relative", className)}
      role={label ? "img" : undefined}
    >
      <svg
        aria-hidden
        className="h-full w-full overflow-visible"
        preserveAspectRatio="xMidYMid meet"
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/** biome-ignore lint/security/noDangerouslySetInnerHtml: generated gradients/clip, no user input. */}
        <defs dangerouslySetInnerHTML={{ __html: buildDefs(uid) }} />
        {/** biome-ignore lint/security/noDangerouslySetInnerHtml: generated line-art, no user input. */}
        <g dangerouslySetInnerHTML={{ __html: buildFrame(uid) }} />
        <g clipPath={`url(#${uid}-open)`}>
          {/** biome-ignore lint/security/noDangerouslySetInnerHtml: generated line-art, no user input. */}
          <g dangerouslySetInnerHTML={{ __html: buildIris(START_PUPIL, uid) }} ref={irisRef} />
        </g>
      </svg>
    </div>
  );
}
