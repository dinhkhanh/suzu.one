// The face kiosk's eyes, in the browser (FR-ATT-06): MediaPipe's face landmarker finds faces and
// their landmarks, OpenCV's SFace (ONNX Runtime, WebAssembly) turns a lined-up face into 128
// numbers. Everything is served by the app itself (public/kiosk/assets, scripts/kiosk-assets.mjs),
// and nothing the camera sees leaves the tablet: only the numbers do. The arithmetic between the
// two models is `engine/face.ts`.
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { InferenceSession } from "onnxruntime-web";
import { ALIGNED_SIZE, alignmentMatrix, applyAffine, alignedFace, type FivePoints, fivePointsFromMesh, invertAffine, normalise, nosePosition } from "../../engine/face";
import { withModestMemory } from "./wasm-memory";

const ASSETS = "/kiosk/assets";

export type Source = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap;

/** The largest face in a frame, and how many there are. `width` is a fraction of the frame's width. */
export type Detection = { count: number; points: FivePoints; width: number; position: number | null };

export type FaceEngine = {
  /** A camera frame (`video`, with a timestamp that only grows) or a still picture. */
  detect(source: Source, timestamp?: number): Detection | null;
  /** The face at `points` in `source`, as an L2-normalised embedding. */
  embed(source: Source, points: FivePoints): Promise<number[]>;
  close(): void;
};

const sizeOf = (source: Source): [number, number] =>
  source instanceof HTMLVideoElement ? [source.videoWidth, source.videoHeight] : source instanceof HTMLImageElement ? [source.naturalWidth, source.naturalHeight] : [source.width, source.height];

async function landmarker(mode: "VIDEO" | "IMAGE"): Promise<FaceLandmarker> {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(`${ASSETS}/vendor/mediapipe`);
  const options = (delegate: "GPU" | "CPU") => ({ baseOptions: { modelAssetPath: `${ASSETS}/models/face_landmarker.task`, delegate }, runningMode: mode, numFaces: 2, minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.5 });
  // The GPU is quicker where there is one that WebGL can use; a tablet without falls back to the CPU.
  try {
    return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

async function recogniser(): Promise<{ session: InferenceSession; Tensor: typeof import("onnxruntime-web").Tensor }> {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.wasmPaths = `${ASSETS}/vendor/ort/`;
  // SFace's export lists its weights as graph inputs, which ONNX Runtime warns about on every load.
  ort.env.logLevel = "error";
  // Threads need a cross-origin-isolated page; one thread embeds a face in a few tens of milliseconds.
  ort.env.wasm.numThreads = 1;
  // The runtime starts with the first session, and asks for its memory then (wasm-memory.ts).
  const session = await withModestMemory(() => ort.InferenceSession.create(`${ASSETS}/models/face_recognition_sface_2021dec_int8.onnx`, { executionProviders: ["wasm"], graphOptimizationLevel: "all", logSeverityLevel: 3 }));
  return { session, Tensor: ort.Tensor };
}

/** Which of the two did not load, kept in front of the browser's own words: the screen shows it and the report carries it. */
const named = (part: "landmarker" | "recogniser") => (error: unknown) => {
  throw new Error(`${part}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`, { cause: error });
};

/** Loads both models. `mode` is how `detect` is fed: a running camera, or still pictures. */
export async function loadFaceEngine(mode: "VIDEO" | "IMAGE"): Promise<FaceEngine> {
  const [marker, { session, Tensor }] = await Promise.all([landmarker(mode).catch(named("landmarker")), recogniser().catch(named("recogniser"))]);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true })!;

  return {
    detect(source, timestamp) {
      const result = mode === "VIDEO" ? marker.detectForVideo(source as HTMLVideoElement, timestamp ?? performance.now()) : marker.detect(source as HTMLImageElement);
      const faces = result.faceLandmarks;
      if (!faces.length) return null;
      const [width, height] = sizeOf(source);
      const spans = faces.map((landmarks) => Math.max(...landmarks.map((point) => point.x)) - Math.min(...landmarks.map((point) => point.x)));
      const largest = spans.indexOf(Math.max(...spans));
      const points = fivePointsFromMesh(faces[largest], width, height);
      if (!points) return null;
      return { count: faces.length, points, width: spans[largest], position: nosePosition(points) };
    },

    async embed(source, points) {
      // Only the part of the frame the 112 × 112 face is cut from is read back, not the whole frame.
      const back = invertAffine(alignmentMatrix(points));
      const corners = [[0, 0], [ALIGNED_SIZE, 0], [0, ALIGNED_SIZE], [ALIGNED_SIZE, ALIGNED_SIZE]].map(([x, y]) => applyAffine(back, [x, y]));
      const [width, height] = sizeOf(source);
      const left = Math.max(0, Math.floor(Math.min(...corners.map((point) => point[0]))) - 1);
      const top = Math.max(0, Math.floor(Math.min(...corners.map((point) => point[1]))) - 1);
      const right = Math.min(width, Math.ceil(Math.max(...corners.map((point) => point[0]))) + 1);
      const bottom = Math.min(height, Math.ceil(Math.max(...corners.map((point) => point[1]))) + 1);
      canvas.width = Math.max(1, right - left);
      canvas.height = Math.max(1, bottom - top);
      context.drawImage(source, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const shifted = points.map(([x, y]) => [x - left, y - top] as const) as unknown as FivePoints;
      const input = new Tensor("float32", alignedFace(pixels, canvas.width, canvas.height, shifted), [1, 3, ALIGNED_SIZE, ALIGNED_SIZE]);
      const output = await session.run({ [session.inputNames[0]]: input });
      return normalise(output[session.outputNames[0]].data as Float32Array);
    },

    close() {
      marker.close();
      void session.release();
    },
  };
}
