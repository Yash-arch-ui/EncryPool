"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

export function MetallicVaultMark() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = Boolean(useReducedMotion());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    });
    observer.observe(canvas);

    let frame = 0;
    const render = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const t = reducedMotion ? 0 : time * 0.00045;
      context.clearRect(0, 0, width, height);

      const glow = context.createRadialGradient(
        width * 0.52,
        height * 0.5,
        8,
        width * 0.52,
        height * 0.5,
        width * 0.55,
      );
      glow.addColorStop(0, "rgba(255, 193, 69, 0.22)");
      glow.addColorStop(0.45, "rgba(46, 196, 182, 0.08)");
      glow.addColorStop(1, "rgba(7, 9, 15, 0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      const size = Math.min(width, height) * 0.58;
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      context.save();
      context.translate(centerX, centerY);
      context.rotate(-0.08 + Math.sin(t * 2) * 0.03);
      context.beginPath();
      context.roundRect(-size * 0.5, -size * 0.5, size, size, size * 0.16);
      context.clip();

      const metal = context.createLinearGradient(-size, -size, size, size);
      const shift = (Math.sin(t * 3.2) + 1) * 0.5;
      metal.addColorStop(0, "#10141f");
      metal.addColorStop(Math.max(0.12, shift * 0.35), "#2ec4b6");
      metal.addColorStop(Math.min(0.58, 0.28 + shift * 0.22), "#f5efe4");
      metal.addColorStop(Math.min(0.82, 0.55 + shift * 0.18), "#ffc145");
      metal.addColorStop(1, "#0b0f18");
      context.fillStyle = metal;
      context.fillRect(-size, -size, size * 2, size * 2);

      context.globalCompositeOperation = "screen";
      for (let index = 0; index < 10; index += 1) {
        const y = -size * 0.58 + index * size * 0.13 + Math.sin(t * 2 + index * 0.7) * size * 0.06;
        context.beginPath();
        context.moveTo(-size, y);
        context.bezierCurveTo(-size * 0.15, y - size * 0.12, size * 0.12, y + size * 0.13, size, y - size * 0.04);
        context.lineWidth = size * (index % 3 === 0 ? 0.035 : 0.014);
        context.strokeStyle = index % 2 ? "rgba(255, 255, 255, 0.24)" : "rgba(7, 9, 15, 0.3)";
        context.stroke();
      }
      context.restore();

      context.save();
      context.translate(centerX, centerY);
      context.rotate(-0.08 + Math.sin(t * 2) * 0.03);
      context.strokeStyle = "rgba(255, 255, 255, 0.48)";
      context.lineWidth = 1;
      context.strokeRect(-size * 0.5, -size * 0.5, size, size);
      context.fillStyle = "#07090f";
      context.font = `700 ${Math.max(18, size * 0.19)}px Geist, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("USDC", 0, 2);
      context.font = `500 ${Math.max(8, size * 0.045)}px Geist Mono, monospace`;
      context.fillStyle = "rgba(255,255,255,0.78)";
      context.fillText("SEALED VALUE", 0, size * 0.27);
      context.restore();

      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [reducedMotion]);

  return (
    <div
      className="relative h-72 w-full overflow-hidden rounded-[1.75rem] border border-border/80 bg-background/70 sm:h-80"
      aria-label="Animated metallic USDC vault seal"
      role="img"
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,var(--background)_95%)] opacity-60" />
      <div className="pointer-events-none absolute inset-x-8 bottom-5 flex justify-between font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
        <span>Liquid metal seal</span>
        <span>FHE / 01</span>
      </div>
    </div>
  );
}
