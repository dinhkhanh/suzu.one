// A QR code drawn as one SVG path; the server encodes it (`qrPath`), so no encoder ships to the tablet.
export function QrCode({ path, modules, size, label }: { path: string; modules: number; size: number; label: string }) {
  return (
    <svg viewBox={`0 0 ${modules} ${modules}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect width={modules} height={modules} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
