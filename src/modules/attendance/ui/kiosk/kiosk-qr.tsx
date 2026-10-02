"use client";
// A QR code drawn on the tablet as one SVG path, from the in-house encoder (`@/lib/qr`): the kiosk
// gets five minutes of codes in one request and draws each in its turn.
import { useMemo } from "react";
import { encodeQr } from "@/lib/qr";

export function QrCode({ text, size, label }: { text: string; size: number; label: string }) {
  const { path, modules } = useMemo(() => {
    const matrix = encodeQr(text);
    const quiet = 2;
    const parts: string[] = [];
    for (let row = 0; row < matrix.size; row++) for (let col = 0; col < matrix.size; col++) if (matrix.modules[row][col]) parts.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
    return { path: parts.join(""), modules: matrix.size + quiet * 2 };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${modules} ${modules}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect width={modules} height={modules} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
