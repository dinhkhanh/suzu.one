import { describe, expect, it } from "vitest";
import { ALIGNED_SIZE, alignedFace, alignmentMatrix, applyAffine, challengeVerdict, cosine, decideMatch, type FivePoints, fivePointsFromMesh, invertAffine, isEmbedding, normalise, nosePosition, REFERENCE_POINTS } from "./face";

const straight: FivePoints = [
  [100, 100],
  [160, 100],
  [130, 130],
  [108, 160],
  [152, 160],
];

/** The same five points seen through an affine map: what a tilted, turned, moved photo does to them. */
const through = (points: FivePoints, [a, b, c, d, e, f]: readonly number[]): FivePoints => points.map(([x, y]) => [a * x + b * y + c, d * x + e * y + f] as const) as unknown as FivePoints;

describe("is it a real head", () => {
  it("puts a face looking straight at the camera at the middle", () => {
    expect(nosePosition(straight)).toBeCloseTo(0.5, 6);
  });

  it("gives a photo the same number however it is held", () => {
    for (const map of [
      [1, 0, 50, 0, 1, -20],
      [0.8, 0.3, 10, -0.2, 1.1, 40],
      [Math.cos(0.5), -Math.sin(0.5), 0, Math.sin(0.5), Math.cos(0.5), 0],
    ]) {
      expect(nosePosition(through(straight, map))).toBeCloseTo(0.5, 6);
    }
  });

  it("moves when the nose crosses the face", () => {
    const turned: FivePoints = [straight[0], straight[1], [145, 130], straight[3], straight[4]];
    expect(nosePosition(turned)).toBeCloseTo(0.75, 6);
  });

  it("has no answer for points on one line", () => {
    expect(nosePosition([[0, 0], [10, 0], [5, 0], [0, 0], [10, 0]])).toBeNull();
  });

  it("passes a turn the asked way, fails the other way, waits in between", () => {
    expect(challengeVerdict("left", 0.5, 0.65)).toBe("pass");
    expect(challengeVerdict("left", 0.5, 0.35)).toBe("wrong_way");
    expect(challengeVerdict("right", 0.5, 0.35)).toBe("pass");
    expect(challengeVerdict("right", 0.5, 0.55)).toBe("wait");
  });
});

describe("the five points out of the mesh", () => {
  it("orders the eyes and the mouth corners camera-left first, in pixels", () => {
    const mesh = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    mesh[468] = { x: 0.6, y: 0.4 };
    mesh[473] = { x: 0.4, y: 0.4 };
    mesh[1] = { x: 0.5, y: 0.5 };
    mesh[61] = { x: 0.42, y: 0.6 };
    mesh[291] = { x: 0.58, y: 0.6 };
    expect(fivePointsFromMesh(mesh, 1000, 500)).toEqual([
      [400, 200],
      [600, 200],
      [500, 250],
      [420, 300],
      [580, 300],
    ]);
    expect(fivePointsFromMesh(mesh.slice(0, 468), 1000, 500)).toBeNull();
  });
});

describe("lining the face up", () => {
  it("finds the exact map when there is one", () => {
    const map = [1.7, -0.4, 30, 0.4, 1.7, -12];
    const seen = through(REFERENCE_POINTS, map);
    const back = alignmentMatrix(seen);
    seen.forEach((point, index) => {
      const [x, y] = applyAffine(back, point);
      expect(x).toBeCloseTo(REFERENCE_POINTS[index][0], 6);
      expect(y).toBeCloseTo(REFERENCE_POINTS[index][1], 6);
    });
  });

  it("inverts a map", () => {
    const map = alignmentMatrix(straight);
    const [x, y] = applyAffine(invertAffine(map), applyAffine(map, [12, 34]));
    expect(x).toBeCloseTo(12, 9);
    expect(y).toBeCloseTo(34, 9);
  });

  it("samples the face into planar RGB, black outside the picture", () => {
    // A 4 × 4 picture, all one colour; the reference points themselves, so the map is the identity.
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    for (let index = 0; index < 16; index++) rgba.set([10, 20, 30, 255], index * 4);
    const out = alignedFace(rgba, 4, 4, REFERENCE_POINTS);
    const plane = ALIGNED_SIZE * ALIGNED_SIZE;
    expect(out).toHaveLength(3 * plane);
    expect([out[0], out[plane], out[2 * plane]]).toEqual([10, 20, 30]);
    expect(out[plane - 1]).toBe(0);
  });
});

describe("whose face is it", () => {
  it("normalises and compares", () => {
    expect(normalise([3, 4])).toEqual([0.6, 0.8]);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1, 9);
  });

  it("accepts only a full, finite, non-zero embedding", () => {
    expect(isEmbedding(Array.from({ length: 128 }, () => 0.1))).toBe(true);
    expect(isEmbedding(Array.from({ length: 127 }, () => 0.1))).toBe(false);
    expect(isEmbedding(Array.from({ length: 128 }, () => 0))).toBe(false);
    expect(isEmbedding([...Array.from({ length: 127 }, () => 0.1), Number.NaN])).toBe(false);
  });

  it("names a face only above the line and clear of the runner-up", () => {
    const settings = { threshold: 0.4, margin: 0.05 };
    expect(decideMatch({ personId: "a", score: 0.6 }, { personId: "b", score: 0.3 }, settings)).toEqual({ personId: "a", score: 0.6 });
    expect(decideMatch({ personId: "a", score: 0.6 }, null, settings)).toEqual({ personId: "a", score: 0.6 });
    expect(decideMatch({ personId: "a", score: 0.39 }, null, settings)).toBeNull();
    expect(decideMatch({ personId: "a", score: 0.6 }, { personId: "b", score: 0.57 }, settings)).toBeNull();
    expect(decideMatch(null, null, settings)).toBeNull();
  });
});
