// Front-facing ornate mystic eye, drawn as ink line-art in SVG so it matches the
// tattoo reference: a realistic iris (radial fibres, collarette, limbal ring,
// pupil, catchlight) inside almond lids, wreathed in flame tendrils with rhombus
// ornaments above and below. Light-on-dark for the player card, with a blue
// mystic glow. Every path is generated deterministically so server and client
// render the same markup. Pure functions returning SVG strings.

export const VIEW = { w: 420, h: 280 };
export const CENTRE = [210, 140];
export const IRIS_R = 60;
export const PUPIL_MIN = 20;
export const PUPIL_MAX = 34;
/** Largest gaze offset in viewBox px (the iris stays inside the lids). */
export const GAZE_PX = 16;

const INK = "rgba(205,216,248,0.92)"; // pale lavender ink on dark
const INK_SOFT = "rgba(160,185,235,0.5)";
const INK_FAINT = "rgba(140,165,222,0.28)";

// Deterministic RNG so SSR and client agree.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pt = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
const fmt = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

// Almond eye opening, as a closed path. `open` 0..1 scales the lid height.
function almondPath(open = 1) {
  const [cx, cy] = CENTRE;
  const halfW = 150;
  const halfH = 74 * open;
  const upper = [];
  const lower = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = -1 + (2 * i) / steps;
    const x = cx + t * halfW;
    // Almond: sharp canthi, full centre; a touch of droop toward the inner corner.
    const shape = (1 - t * t) ** 0.72;
    upper.push([x, cy - halfH * shape]);
    lower.push([x, cy + halfH * 0.86 * shape]);
  }
  const u = upper.map((p, i) => `${i ? "L" : "M"}${fmt(p)}`).join("");
  const l = lower.reverse().map((p) => `L${fmt(p)}`).join("");
  return `${u}${l}Z`;
}

export function buildDefs(uid = "mystic") {
  return `<defs>
    <radialGradient id="${uid}-iris" cx="50%" cy="46%" r="54%">
      <stop offset="0%" stop-color="rgb(120,160,255)"/>
      <stop offset="42%" stop-color="rgb(40,95,240)"/>
      <stop offset="82%" stop-color="rgb(22,46,130)"/>
      <stop offset="100%" stop-color="rgb(10,18,52)"/>
    </radialGradient>
    <radialGradient id="${uid}-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="rgb(150,185,255)" stop-opacity="0.9"/>
      <stop offset="45%" stop-color="rgb(45,105,240)" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="rgb(25,60,180)" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${uid}-sclera" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="rgba(32,40,66,0.9)"/>
      <stop offset="100%" stop-color="rgba(12,16,32,0.95)"/>
    </radialGradient>
    <clipPath id="${uid}-open"><path d="${almondPath(1)}"/></clipPath>
  </defs>`;
}

// ---- The iris (moving group: dilates and gazes) -------------------------------
export function buildIris(pupilR, uid = "mystic") {
  const [cx, cy] = CENTRE;
  const out = [];
  // Sclera-tinted backing and the iris disc.
  out.push(`<circle cx="${cx}" cy="${cy}" r="${IRIS_R}" fill="url(#${uid}-iris)"/>`);

  // Radial fibres: many fine strokes from near the pupil out to the limbus.
  const rand = rng(20260716);
  const fibres = 150;
  let fib = "";
  for (let i = 0; i < fibres; i++) {
    const a = (i / fibres) * Math.PI * 2 + rand() * 0.04;
    const r0 = pupilR + 1 + rand() * 3;
    const r1 = IRIS_R - 3 - rand() * 16;
    const mid = (r0 + r1) / 2 + (rand() - 0.5) * 6;
    const am = a + (rand() - 0.5) * 0.05;
    const p0 = pt(cx, cy, r0, a);
    const pm = pt(cx, cy, mid, am);
    const p1 = pt(cx, cy, r1, a);
    fib += `M${fmt(p0)}Q${fmt(pm)} ${fmt(p1)}`;
  }
  out.push(`<path d="${fib}" fill="none" stroke="${INK_SOFT}" style="stroke-width:0.6"/>`);

  // Collarette: a wavy ring partway out.
  const coll = IRIS_R * 0.52;
  let cd = "";
  const cs = 90;
  for (let i = 0; i <= cs; i++) {
    const a = (i / cs) * Math.PI * 2;
    const r = coll + Math.sin(a * 11) * 3.2;
    const p = pt(cx, cy, r, a);
    cd += `${i ? "L" : "M"}${fmt(p)}`;
  }
  out.push(`<path d="${cd}Z" fill="none" stroke="${INK}" style="stroke-width:1.1;opacity:0.7"/>`);

  // Limbal ring: dark, thick outer edge.
  out.push(`<circle cx="${cx}" cy="${cy}" r="${IRIS_R - 1.5}" fill="none" stroke="rgb(14,10,30)" style="stroke-width:4"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${IRIS_R}" fill="none" stroke="${INK}" style="stroke-width:1.2;opacity:0.6"/>`);

  // Pupil: black void with a glowing blue rim.
  out.push(`<circle cx="${cx}" cy="${cy}" r="${(pupilR + 4).toFixed(1)}" fill="url(#${uid}-glow)" data-glow/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${pupilR.toFixed(1)}" fill="rgb(5,4,10)"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${pupilR.toFixed(1)}" fill="none" stroke="rgb(90,140,255)" style="stroke-width:2.4;opacity:0.9;filter:blur(1px)"/>`);

  // Catchlight: a bright teardrop, upper-left.
  const gx = cx - pupilR * 0.5;
  const gy = cy - pupilR * 0.62;
  out.push(`<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="${(pupilR * 0.28).toFixed(1)}" fill="rgba(235,230,255,0.95)"/>`);
  out.push(`<circle cx="${(cx + pupilR * 0.4).toFixed(1)}" cy="${(cy + pupilR * 0.45).toFixed(1)}" r="${(pupilR * 0.12).toFixed(1)}" fill="rgba(150,185,255,0.6)"/>`);
  return out.join("");
}

// ---- Static frame: lids, lashes, flames, ornaments, spatter -------------------
export function buildFrame(uid = "mystic") {
  const [cx, cy] = CENTRE;
  const out = [];
  const rand = rng(911);

  // Sclera inside the opening (behind the iris, so corners read as eyeball).
  out.push(`<path d="${almondPath(1)}" fill="url(#${uid}-sclera)"/>`);

  // Upper and lower lid lines (double stroke) following the almond.
  const lidLine = (open, dy, w, op) => {
    const [, ] = CENTRE;
    const halfW = 150;
    const steps = 40;
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = -1 + (2 * i) / steps;
      const x = cx + t * halfW;
      const shape = (1 - t * t) ** 0.72;
      const y = cy - 74 * open * shape + dy;
      d += `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }
    return `<path d="${d}" fill="none" stroke="${INK}" style="stroke-width:${w};opacity:${op}"/>`;
  };
  out.push(lidLine(1, 0, 2.4, 0.95)); // upper crease edge
  out.push(lidLine(1, -7, 1.4, 0.5)); // upper fold
  out.push(lidLine(-0.86, 0, 2.2, 0.9)); // lower lid
  out.push(lidLine(-0.86, 7, 1.2, 0.4)); // lower fold

  // Lashes: short radial strokes hanging off the upper lid, fanning outward.
  let lash = "";
  const steps = 26;
  for (let i = 1; i < steps; i++) {
    const t = -1 + (2 * i) / steps;
    const x = cx + t * 150;
    const shape = (1 - t * t) ** 0.72;
    const y = cy - 74 * shape;
    const dir = Math.sign(t) || 1;
    const len = 10 + 10 * (1 - Math.abs(t));
    const ex = x + dir * len * 0.5;
    const ey = y - len;
    lash += `M${x.toFixed(2)},${y.toFixed(2)}Q${(x + dir * 2).toFixed(2)},${(y - len * 0.6).toFixed(2)} ${ex.toFixed(2)},${ey.toFixed(2)}`;
  }
  out.push(`<path d="${lash}" fill="none" stroke="${INK}" style="stroke-width:1.4;opacity:0.85"/>`);

  // Flame tendrils from the two canthi (corners), curling outward.
  out.push(flames(cx - 150, cy, -1, rand));
  out.push(flames(cx + 150, cy, 1, rand));

  // Rhombus ornaments above and below centre.
  out.push(rhombus(cx, cy - 104, 12, 22));
  out.push(rhombus(cx, cy + 108, 11, 20));

  // Ink spatter dots scattered around.
  let dots = "";
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2;
    const r = 120 + rand() * 90;
    const p = pt(cx, cy, r * 0.9, a);
    const rr = 0.6 + rand() * 1.8;
    dots += `<circle cx="${p[0].toFixed(1)}" cy="${(p[1] * 1).toFixed(1)}" r="${rr.toFixed(1)}" fill="${INK_FAINT}"/>`;
  }
  out.push(dots);
  return out.join("");
}

// A cluster of curling flame tongues from the canthus (ox,oy), fanning out and
// up (dir = ±1). Each tongue is a tapering S-curve that ends in a sharp tip.
function flames(ox, oy, dir, rand) {
  const out = [];
  // Clean flame tongues fanning up-and-out, each a teardrop that hooks at the tip.
  const tongues = [
    { ang: -0.15, len: 92, w: 9 },
    { ang: -0.52, len: 76, w: 8 },
    { ang: -0.95, len: 54, w: 6.5 },
  ];
  for (let t = 0; t < tongues.length; t++) {
    const { ang, len, w } = tongues[t];
    const L = len + (rand() - 0.5) * 8;
    const base = [ox - dir * 2, oy - 2];
    const dx = dir * Math.cos(ang);
    const dy = Math.sin(ang);
    const tip = [base[0] + dx * L, base[1] + dy * L];
    // One side bulges (the belly of the flame), the other stays lean, then a hook.
    const belly = [base[0] + dx * L * 0.42 - dy * w * 2.4, base[1] + dy * L * 0.42 + dx * w * 2.4];
    const lean = [base[0] + dx * L * 0.62 + dy * w * 0.6, base[1] + dy * L * 0.62 - dx * w * 0.6];
    const d = `M${fmt(base)}Q${fmt(belly)} ${fmt(tip)}Q${fmt(lean)} ${fmt([base[0], base[1]])}Z`;
    out.push(
      `<path d="${d}" fill="${t % 2 ? "rgba(90,140,255,0.1)" : INK_FAINT}" stroke="${INK}" style="stroke-width:1.5;opacity:0.9;stroke-linejoin:round"/>`
    );
  }
  return out.join("");
}

function rhombus(cx, cy, w, h) {
  const d = `M${cx},${(cy - h).toFixed(1)}L${(cx + w).toFixed(1)},${cy}L${cx},${(cy + h).toFixed(1)}L${(cx - w).toFixed(1)},${cy}Z`;
  const inner = `M${cx},${(cy - h * 0.55).toFixed(1)}L${(cx + w * 0.5).toFixed(1)},${cy}L${cx},${(cy + h * 0.55).toFixed(1)}L${(cx - w * 0.5).toFixed(1)},${cy}Z`;
  return `<path d="${d}" fill="rgba(90,140,255,0.1)" stroke="${INK}" style="stroke-width:1.6"/><path d="${inner}" fill="none" stroke="${INK_SOFT}" style="stroke-width:1"/>`;
}
