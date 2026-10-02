// The face kiosk's runtimes, served by the app itself (src/modules/attendance/ui/kiosk/face-engine.ts):
// MediaPipe's and ONNX Runtime's WebAssembly files, copied from node_modules into public/ on every
// install, so a kiosk never depends on a third-party CDN and the files always match the installed
// packages. The models themselves are committed beside them (public/kiosk/assets/models).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = join(root, "public", "kiosk", "assets", "vendor");
const files = {
  mediapipe: ["@mediapipe/tasks-vision/wasm", ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]],
  ort: ["onnxruntime-web/dist", ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]],
};

for (const [folder, [from, names]] of Object.entries(files)) {
  const source = join(root, "node_modules", from);
  if (!existsSync(source)) {
    console.warn(`kiosk-assets: ${from} is not installed; the face kiosk will not load.`);
    continue;
  }
  mkdirSync(join(out, folder), { recursive: true });
  for (const name of names) copyFileSync(join(source, name), join(out, folder, name));
}
