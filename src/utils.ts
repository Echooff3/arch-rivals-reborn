
import * as THREE from "three";

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function randInt(a: number, b: number): number {
  return Math.floor(rand(a, b + 1));
}

export function signedRand(amp = 1): number {
  return (Math.random() - 0.5) * 2 * amp;
}

export function distXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function angleXZ(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

// Smooth damp angle (shortest path)
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------- Canvas texture helpers ----------
export function makeCanvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Solve projectile launch velocity to hit target
// Returns velocity vector (x,y,z). dx/dz = horizontal delta, dy = vertical delta
export function solveArc(
  dx: number, dy: number, dz: number,
  angle: number, gravity: number
): THREE.Vector3 {
  const horiz = Math.sqrt(dx * dx + dz * dz);
  const g = Math.abs(gravity);
  const cos2 = Math.cos(angle) * Math.cos(angle);
  const denom = 2 * cos2 * (horiz * Math.tan(angle) - dy);
  if (denom <= 0) {
    // fallback: direct toss
    const t = 0.9;
    return new THREE.Vector3(dx / t, (dy + 0.5 * g * t * t) / t, dz / t);
  }
  const v0 = Math.sqrt((g * horiz * horiz) / denom);
  const vy = v0 * Math.sin(angle);
  const vh = v0 * Math.cos(angle);
  const nx = dx / horiz;
  const nz = dz / horiz;
  return new THREE.Vector3(nx * vh, vy, nz * vh);
}

export function vec2(x: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, 0, z);
}
