/**
 * Type declarations for the Anatomy skill's WebGL layer (`kit/gl.mjs`, copied
 * verbatim). Only the exports used in this app are declared. See the skill's
 * `references/webgl.md` for the full contract.
 */

export interface GlCameraProjection {
  origin: [number, number];
  scale: number;
  azimuth?: number;
  elevation?: number;
}

export interface GlCamera {
  origin: [number, number];
  k: number;
  cam: [number, number, number, number];
}

export function glCamera(projection: GlCameraProjection): GlCamera;

export type UniformValue = number | number[] | Float32Array;

export interface GlLayer {
  gl: WebGLRenderingContext;
  extensions: string[];
  set(values?: Record<string, UniformValue>): void;
  draw(values?: Record<string, UniformValue>, time?: number): void;
  clear(): void;
}

export interface GlLayerOptions {
  canvas: HTMLCanvasElement;
  fragment: string;
  view: [number, number];
  camera: GlCamera;
  uniforms?: string[];
  fixed?: Record<string, UniformValue>;
  extensions?: string[];
  maxRatio?: number;
  onError?: (message: string) => void;
}

/** Compile `GLSL_ISO + fragment`; returns null when WebGL is missing or compile fails. */
export function glLayer(options: GlLayerOptions): GlLayer | null;

/** Smoothstep clamped to [0,1]. */
export function smooth(a: number, b: number, x: number): number;

/** One-shot envelope: smoothstep attack over `rise`, exponential decay over `fall`. */
export function burst(age: number, rise: number, fall: number): number;

export interface SpringState {
  x: number;
  v: number;
}

/** Critically damped follow of `state` toward `target`; returns true while moving. */
export function settle(
  state: SpringState,
  target: number,
  dt: number,
  seconds: number,
  calm?: boolean
): boolean;

export const GLSL_ISO: string;
