/**
 * A picture as a profile photo or project poster is stored: square, at most `edge` a side, JPEG.
 * Whatever the phone took — 12 MP, HEIC where the browser can open it, turned by its EXIF
 * orientation — arrives as a few hundred kilobytes. The square is cut from the middle across;
 * down, `top` is the share of the leftover height kept above it (½ centres it, ⅓ sits a little
 * above the middle, where a portrait's face usually is). Null when the browser cannot open the file.
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
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  return blob ? new File([blob], name, { type: "image/jpeg" }) : null;
}
