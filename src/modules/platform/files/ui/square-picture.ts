/**
 * A picture as a profile photo or project poster is stored: square, at most `edge` a side, JPEG —
 * or, when it has see-through parts (a logo, a cut-out portrait), WebP, or PNG where the browser
 * cannot write WebP, so they stay see-through. JPEG has no transparency: the canvas's empty pixels
 * are transparent black, and a transparent PNG came out on black. Whatever the phone took — 12 MP,
 * HEIC where the browser can open it, turned by its EXIF orientation — arrives as a few hundred
 * kilobytes. The square is cut from the middle across; down, `top` is the share of the leftover
 * height kept above it (½ centres it, ⅓ sits a little above the middle, where a portrait's face
 * usually is). `name` has no extension: the format chosen gives it one, and the upload checks the
 * bytes against it. Null when the browser cannot open the file.
 */
export async function squarePicture(file: File, { edge: maxEdge, name, top = 1 / 2 }: { edge: number; name: string; top?: number }): Promise<File | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const side = Math.min(bitmap.width, bitmap.height);
  const edge = Math.min(side, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) * top, side, side, 0, 0, edge, edge);
  bitmap.close();
  const type = hasTransparency(context, edge) ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) return null;
  // Asked for a type it cannot write, a browser hands back PNG — which keeps transparency too.
  const extension = EXTENSIONS[blob.type];
  return extension ? new File([blob], `${name}.${extension}`, { type: blob.type }) : null;
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };

function hasTransparency(context: CanvasRenderingContext2D, edge: number): boolean {
  const pixels = context.getImageData(0, 0, edge, edge).data;
  for (let alpha = 3; alpha < pixels.length; alpha += 4) if (pixels[alpha] < 255) return true;
  return false;
}
