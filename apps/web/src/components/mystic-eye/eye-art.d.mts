export const VIEW: { w: number; h: number };
export const CENTRE: [number, number];
export const IRIS_R: number;
export const PUPIL_MIN: number;
export const PUPIL_MAX: number;
export const GAZE_PX: number;
export function buildDefs(uid?: string): string;
export function buildIris(pupilR: number, uid?: string): string;
export function buildFrame(uid?: string): string;
