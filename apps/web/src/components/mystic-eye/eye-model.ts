/**
 * Pure motion model for the mystic eye. It owns no DOM: given a time step and
 * the latest pointer position it eases the gaze with a critically damped spring,
 * runs idle saccades when the pointer goes quiet, and breathes the pupil and
 * glow. Everything it returns is a shader uniform. This is the one place that
 * decides how the eye moves, so the look is consistent wherever the eye is used.
 */
import { burst, settle, type SpringState } from "../iso/gl.mjs";

export interface EyeUniforms {
  uGaze: [number, number];
  uDilate: number;
  uGlow: number;
}

/** Largest gaze offset, in sphere units, before the look clamps. */
const GAZE_MAX = 0.85;
/** Seconds of pointer silence before the eye starts wandering on its own. */
const IDLE_AFTER = 2.5;

export interface EyeMotion {
  /** Record a pointer at normalized canvas coordinates ([-1,1], y up). */
  pointer(nx: number, ny: number): void;
  /** Advance the model by `dt` seconds and read the uniforms. `calm` snaps it. */
  step(dt: number, calm?: boolean): EyeUniforms;
}

export function createEyeMotion({ follow = true } = {}): EyeMotion {
  const gx: SpringState = { x: 0, v: 0 };
  const gy: SpringState = { x: 0, v: 0 };
  let clock = 0;
  let sincePointer = IDLE_AFTER; // start idle so the eye wanders before any input
  let target: [number, number] = [0, 0];
  let idleTarget: [number, number] = [0, 0];
  let nextSaccade = 0;
  let lastSaccade = -10;

  return {
    pointer(nx, ny) {
      if (!follow) return;
      const clamp = (v: number) => Math.max(-GAZE_MAX, Math.min(GAZE_MAX, v * 0.6));
      target = [clamp(nx), clamp(ny)];
      sincePointer = 0;
    },
    step(dt, calm = false) {
      clock += dt;
      sincePointer += dt;

      let tx: number;
      let ty: number;
      if (follow && sincePointer < IDLE_AFTER) {
        [tx, ty] = target;
      } else {
        if (clock >= nextSaccade) {
          idleTarget = [(Math.random() * 2 - 1) * 0.5, (Math.random() * 2 - 1) * 0.4];
          nextSaccade = clock + 1.2 + Math.random() * 2.6;
          lastSaccade = clock;
        }
        [tx, ty] = idleTarget;
      }

      const seconds = follow && sincePointer < IDLE_AFTER ? 0.12 : 0.35;
      settle(gx, tx, dt, seconds, calm);
      settle(gy, ty, dt, seconds, calm);

      // Pupil and glow breathe slowly; a saccade gives a brief mystic flare.
      const flare = calm ? 0 : burst(clock - lastSaccade, 0.12, 0.5);
      const dilate = calm ? 0.45 : 0.45 + 0.22 * Math.sin(clock * 0.45) - 0.12 * flare;
      const glow = calm ? 0.5 : 0.45 + 0.35 * Math.sin(clock * 0.7 + 1.0) + 0.3 * flare;

      return {
        uGaze: [gx.x, gy.x],
        uDilate: Math.max(0, Math.min(1, dilate)),
        uGlow: Math.max(0, Math.min(1, glow)),
      };
    },
  };
}
