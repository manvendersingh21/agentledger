"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface PixelGlobeProps {
  /** CSS pixel size of the (square) canvas. */
  size?: number;
  className?: string;
  /** Number of pixel cells across the canvas. Defaults scale with size. */
  resolution?: number;
  /** Rotation speed multiplier. */
  speed?: number;
  /** Show the tilted ring. */
  ring?: boolean;
}

// Palette, light → dark (index 0 = empty).
const PALETTE = ["", "#EEEEFF", "#C8C8FF", "#7A7AFF", "#2B2BFF", "#0000FF"] as const;

// 4x4 Bayer matrix normalised to [0, 1).
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);
  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);
  return lerp(
    lerp(lerp(c000, c100, xf), lerp(c010, c110, xf), yf),
    lerp(lerp(c001, c101, xf), lerp(c011, c111, xf), yf),
    zf,
  );
}

interface RingParticle {
  angle: number;
  radius: number;
  shade: number;
}

function makeRing(count: number): RingParticle[] {
  const out: RingParticle[] = [];
  for (let i = 0; i < count; i++) {
    const u = hash3(i, 1.3, 7.1);
    const v = hash3(i, 5.7, 2.9);
    const w = hash3(i, 9.1, 4.4);
    // Two bands with a gap, denser on the inside.
    const band = v < 0.62 ? 1.32 + u * 0.22 : 1.62 + u * 0.16;
    out.push({ angle: w * Math.PI * 2, radius: band, shade: hash3(i, 3.3, 8.8) });
  }
  return out;
}

/**
 * Dithered pixel planet with a tilted ring, rendered on a canvas.
 * DPR aware, pauses offscreen / in hidden tabs, static under reduced motion.
 */
export function PixelGlobe({
  size = 420,
  className,
  resolution,
  speed = 1,
  ring = true,
}: PixelGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cells = resolution ?? Math.max(28, Math.min(88, Math.round(size / 6)));
    const cell = size / cells;
    const dot = Math.max(1, cell * 0.78);
    const center = cells / 2;
    const R = cells * (ring ? 0.27 : 0.42);
    const tilt = 0.32; // ring opening (rad from edge-on)
    const slant = -0.38; // ring roll in screen plane
    const axialTilt = 0.4;
    const particles = ring ? makeRing(Math.round(cells * 22)) : [];
    const grid = new Uint8Array(cells * cells);
    const depth = new Float32Array(cells * cells);

    // Light direction (top-left, towards viewer).
    const L = [-0.55, -0.6, 0.58];
    const ln = Math.hypot(L[0], L[1], L[2]);
    const lx = L[0] / ln;
    const ly = L[1] / ln;
    const lz = L[2] / ln;
    const cosA = Math.cos(axialTilt);
    const sinA = Math.sin(axialTilt);
    const cosS = Math.cos(slant);
    const sinS = Math.sin(slant);
    const sinT = Math.sin(tilt);
    const cosT = Math.cos(tilt);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function render(t: number) {
      if (!ctx) return;
      grid.fill(0);
      depth.fill(-Infinity);
      const rot = t * 0.00018 * speed;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);

      // Sphere.
      for (let gy = 0; gy < cells; gy++) {
        for (let gx = 0; gx < cells; gx++) {
          const px = (gx + 0.5 - center) / R;
          const py = (gy + 0.5 - center) / R;
          const d2 = px * px + py * py;
          if (d2 > 1) continue;
          const pz = Math.sqrt(1 - d2);
          // Undo axial tilt (rotate around z), then spin around y.
          const ax = px * cosA + py * sinA;
          const ay = -px * sinA + py * cosA;
          const bx = ax * cr + pz * sr;
          const bz = -ax * sr + pz * cr;
          const n =
            noise3(bx * 1.9 + 4, ay * 1.9, bz * 1.9) * 0.68 +
            noise3(bx * 4.6, ay * 4.6 + 9, bz * 4.6) * 0.32;
          const land = n > 0.52;
          const light = Math.max(0, px * lx + py * ly + pz * lz);
          const rim = d2 > 0.86 ? 0.12 : 0;
          let level = land ? 0.5 + light * 0.55 : 0.08 + light * 0.36;
          level += rim;
          const threshold = BAYER[gy & 3][gx & 3];
          const idx = Math.min(5, Math.max(0, Math.floor(level * 5 + threshold - 0.25)));
          const k = gy * cells + gx;
          grid[k] = idx === 0 && d2 > 0.92 ? 1 : idx;
          depth[k] = pz;
        }
      }

      // Ring.
      if (ring) {
        const spin = t * 0.00006 * speed;
        for (const p of particles) {
          const a = p.angle + spin;
          const rx = Math.cos(a) * p.radius;
          const rz0 = Math.sin(a) * p.radius;
          // Tilt the ring plane towards the viewer.
          const ry = rz0 * sinT;
          const rz = rz0 * cosT;
          // Roll in screen plane.
          const sx = rx * cosS - ry * sinS;
          const sy = rx * sinS + ry * cosS;
          const gx = Math.floor(center + sx * R);
          const gy = Math.floor(center + sy * R);
          if (gx < 0 || gy < 0 || gx >= cells || gy >= cells) continue;
          const k = gy * cells + gx;
          const insideSphere = depth[k] !== -Infinity;
          if (insideSphere && rz < 0) continue; // behind the planet
          const shadeBase = rz > 0 ? 0.55 : 0.3;
          const level = shadeBase + p.shade * 0.45;
          const threshold = BAYER[gy & 3][gx & 3];
          const idx = Math.min(5, Math.max(1, Math.floor(level * 5 + threshold - 0.3)));
          if (insideSphere || idx > grid[k]) grid[k] = Math.max(idx, insideSphere ? 3 : 0);
        }
      }

      ctx.clearRect(0, 0, size, size);
      const inset = (cell - dot) / 2;
      for (let c = 1; c < PALETTE.length; c++) {
        ctx.fillStyle = PALETTE[c];
        for (let k = 0; k < grid.length; k++) {
          if (grid[k] !== c) continue;
          const gx = k % cells;
          const gy = (k - gx) / cells;
          ctx.fillRect(gx * cell + inset, gy * cell + inset, dot, dot);
        }
      }
    }

    if (reduceMotion) {
      render(4200);
      return;
    }

    let raf = 0;
    let running = false;
    let inView = true;
    let last = 0;
    let elapsed = 4200;
    const frameMs = 1000 / 30;

    const loop = (now: number) => {
      if (!running) return;
      const dt = last ? now - last : 0;
      if (dt >= frameMs || last === 0) {
        elapsed += Math.min(dt, 100);
        last = now;
        render(elapsed);
      }
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || !inView || document.visibilityState === "hidden") return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    render(elapsed);

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              inView = entries.some((e) => e.isIntersecting);
              if (inView) start();
              else stop();
            },
            { threshold: 0 },
          )
        : null;
    io?.observe(canvas);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [size, resolution, speed, ring]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("block select-none", className)}
      style={{ width: size, height: size }}
    />
  );
}
