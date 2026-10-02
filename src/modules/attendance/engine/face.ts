// The face kiosk's arithmetic (FR-ATT-06). Pure: no I/O, no browser, no model.
//
// The kiosk runs in the tablet's browser. MediaPipe's face landmarker finds the face; this file
// turns its landmarks into the five points the rest needs, lines the face up the way the
// recognition model was trained (`alignmentMatrix`, `alignedFace`), and decides the two questions
// asked of every face: is it a real head turning (`nosePosition`, `challengeVerdict`), and whose
// is it (`decideMatch`). The model itself — OpenCV's SFace, Apache-2.0, 128 numbers per face — runs
// in `ui/kiosk/face-engine.ts`; the server only ever sees those numbers.

/** Which recognition model wrote a template. Templates of another model are never compared with this one's. */
export const FACE_MODEL = "sface-2021dec-int8";
export const EMBEDDING_SIZE = 128;

/**
 * When a face is somebody. Cosine similarity of L2-normalised embeddings. OpenCV gives 0.363 as
 * SFace's same-person line for one-to-one checks; picking one person out of a whole office is a
 * harder question, so the kiosk asks for more, and for a lead over the runner-up: two colleagues
 * who look alike are answered with "not sure", never with the wrong name.
 */
export const MATCH = {
  threshold: 0.42,
  margin: 0.06,
  /** During the head turn the face is only checked to still be the same one. */
  keepThreshold: 0.3,
  /** Enrolling a face this close to somebody else's is refused: it would let one punch for the other. */
  enrolConflict: 0.42,
} as const;

/** How far the nose must cross the face for a turn to count (about 15°). */
export const MIN_TURN = 0.12;

export type Point = readonly [number, number];
/** Camera-left eye, camera-right eye, nose tip, camera-left mouth corner, camera-right mouth corner. */
export type FivePoints = readonly [Point, Point, Point, Point, Point];

// MediaPipe face mesh indices: the iris centres (468, 473 — the landmarker's model has irises),
// the nose tip (1) and the mouth corners (61, 291).
const MESH = { eyes: [468, 473], nose: 1, mouth: [61, 291] } as const;

/**
 * The five points out of MediaPipe's 478 normalised landmarks, in pixels. Each pair is put in
 * camera-left, camera-right order by x, which is what the alignment and the liveness check expect,
 * whichever way the person's own left lies.
 */
export function fivePointsFromMesh(landmarks: readonly { x: number; y: number }[], width: number, height: number): FivePoints | null {
  if (landmarks.length <= Math.max(...MESH.eyes)) return null;
  const at = (index: number): Point => [landmarks[index].x * width, landmarks[index].y * height];
  const pair = ([a, b]: readonly [number, number]): [Point, Point] => {
    const first = at(a);
    const second = at(b);
    return first[0] <= second[0] ? [first, second] : [second, first];
  };
  const [leftEye, rightEye] = pair(MESH.eyes);
  const [leftMouth, rightMouth] = pair(MESH.mouth);
  return [leftEye, rightEye, at(MESH.nose), leftMouth, rightMouth];
}

// ── Is it a real head? ──────────────────────────────────────────────────────────────────────

/**
 * The nose between the eyes in the face's own frame: 0 at the camera-left eye, 1 at the other,
 * about 0.5 looking straight at the camera; null when the points are degenerate.
 *
 * The frame's axes are the line across the eyes and the line from between the eyes down to the
 * mouth, so the number is affine invariant: a printed photo or a phone screen, however it is
 * tilted, turned or moved, keeps it, because all five points lie on one flat surface. Only a real
 * head turning carries the nose across the face.
 */
export function nosePosition(points: FivePoints): number | null {
  const [leftEye, rightEye, nose, leftMouth, rightMouth] = points;
  const eyes: Point = [(leftEye[0] + rightEye[0]) / 2, (leftEye[1] + rightEye[1]) / 2];
  const mouth: Point = [(leftMouth[0] + rightMouth[0]) / 2, (leftMouth[1] + rightMouth[1]) / 2];
  // Solve nose − eyes = a·(rightEye − leftEye) + b·(mouth − eyes) for a.
  const ux = rightEye[0] - leftEye[0];
  const uy = rightEye[1] - leftEye[1];
  const vx = mouth[0] - eyes[0];
  const vy = mouth[1] - eyes[1];
  const det = ux * vy - vx * uy;
  if (Math.abs(det) < 1e-6) return null;
  const px = nose[0] - eyes[0];
  const py = nose[1] - eyes[1];
  return (px * vy - vx * py) / det + 0.5;
}

export type TurnDirection = "left" | "right";
export type TurnVerdict = "pass" | "wrong_way" | "wait";

/**
 * Whether the head turned the way it was asked. The person's own left is the camera's right, and
 * turning that way carries the nose towards the camera-right eye: the position grows.
 */
export function challengeVerdict(direction: TurnDirection, baseline: number, position: number, minTurn: number = MIN_TURN): TurnVerdict {
  const moved = (direction === "left" ? 1 : -1) * (position - baseline);
  if (moved >= minTurn) return "pass";
  if (moved <= -minTurn) return "wrong_way";
  return "wait";
}

// ── Lining the face up ──────────────────────────────────────────────────────────────────────

export const ALIGNED_SIZE = 112;

/** Where ArcFace-style models (SFace among them) expect the five points in their 112 × 112 input. */
export const REFERENCE_POINTS: FivePoints = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** A 2 × 3 affine matrix, row by row: x' = m[0]x + m[1]y + m[2], y' = m[3]x + m[4]y + m[5]. */
export type Affine = readonly [number, number, number, number, number, number];

/**
 * The rotation, uniform scale and shift that carry `from` closest to `to` (least squares; Umeyama
 * without reflection, which in two dimensions has this closed form).
 */
export function alignmentMatrix(from: FivePoints, to: FivePoints = REFERENCE_POINTS): Affine {
  const mean = (points: FivePoints): Point => [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
  const [fx, fy] = mean(from);
  const [tx, ty] = mean(to);
  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (let index = 0; index < from.length; index++) {
    const sx = from[index][0] - fx;
    const sy = from[index][1] - fy;
    const dx = to[index][0] - tx;
    const dy = to[index][1] - ty;
    dot += sx * dx + sy * dy;
    cross += sx * dy - sy * dx;
    norm += sx * sx + sy * sy;
  }
  const a = norm > 0 ? dot / norm : 1;
  const b = norm > 0 ? cross / norm : 0;
  return [a, -b, tx - (a * fx - b * fy), b, a, ty - (b * fx + a * fy)];
}

export const applyAffine = (m: Affine, [x, y]: Point): Point => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

export function invertAffine(m: Affine): Affine {
  const det = m[0] * m[4] - m[1] * m[3];
  const a = m[4] / det;
  const b = -m[1] / det;
  const d = -m[3] / det;
  const e = m[0] / det;
  return [a, b, -(a * m[2] + b * m[5]), d, e, -(d * m[2] + e * m[5])];
}

/**
 * The aligned 112 × 112 face as the model's input: planar RGB (all reds, then greens, then blues),
 * 0–255, bilinear, black outside the picture. `rgba` is a frame as a canvas gives it.
 */
export function alignedFace(rgba: ArrayLike<number>, width: number, height: number, points: FivePoints): Float32Array {
  const size = ALIGNED_SIZE;
  const back = invertAffine(alignmentMatrix(points));
  const out = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [sx, sy] = applyAffine(back, [x, y]);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let channel = 0; channel < 3; channel++) {
        const pixel = (px: number, py: number) => (px < 0 || py < 0 || px >= width || py >= height ? 0 : rgba[(py * width + px) * 4 + channel]);
        const top = pixel(x0, y0) * (1 - fx) + pixel(x0 + 1, y0) * fx;
        const bottom = pixel(x0, y0 + 1) * (1 - fx) + pixel(x0 + 1, y0 + 1) * fx;
        out[channel * plane + y * size + x] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}

// ── Whose face is it? ───────────────────────────────────────────────────────────────────────

export function normalise(vector: ArrayLike<number>): number[] {
  let sum = 0;
  for (let index = 0; index < vector.length; index++) sum += vector[index] * vector[index];
  const norm = Math.sqrt(sum);
  return Array.from(vector, (value) => (norm > 0 ? value / norm : value));
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    na += a[index] * a[index];
    nb += b[index] * b[index];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** A usable embedding: the right length, finite, not all zero. */
export const isEmbedding = (vector: readonly number[]): boolean => vector.length === EMBEDDING_SIZE && vector.every(Number.isFinite) && vector.some((value) => value !== 0);

export type Candidate = { personId: string; score: number };

/**
 * The best person for a face, from the two best scores (each person's best template): named only
 * when the best clears the threshold and leads the runner-up by the margin.
 */
export function decideMatch(best: Candidate | null, runnerUp: Candidate | null, settings: { threshold: number; margin: number } = MATCH): Candidate | null {
  if (!best || best.score < settings.threshold) return null;
  if (runnerUp && best.score - runnerUp.score < settings.margin) return null;
  return best;
}
