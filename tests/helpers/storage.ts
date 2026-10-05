// File storage for tests: the network layer of the files module, kept in memory. A test replaces
// `@/modules/platform/files/storage` with this module, so the files service's own checks (the type
// allow-list, the magic bytes) still run for real and what it wrote can be read back.
//
//   vi.mock("@/modules/platform/files/storage", () => import("../../../tests/helpers/storage"));

/** What was written, by object path. */
export const storedObjects = new Map<string, { bytes: Uint8Array; contentType: string; fileName: string }>();

export class StorageError extends Error {}

export const currentBucket = () => "test-bucket";
export const putObject = async (objectPath: string, bytes: Uint8Array, contentType: string, fileName: string) => void storedObjects.set(objectPath, { bytes, contentType, fileName });
export const createSignedUploadUrl = async (objectPath: string) => `https://storage.invalid/upload/${objectPath}`;
export const createSignedDownloadUrl = async (objectPath: string) => `https://storage.invalid/download/${objectPath}`;
export const inspectObject = async (objectPath: string) => {
  const object = storedObjects.get(objectPath);
  return object ? { sizeBytes: object.bytes.byteLength, head: object.bytes.slice(0, 512) } : null;
};
export const finalizeObject = async () => {};
export const readObject = async () => null;
export const removeObject = async (objectPath: string) => void storedObjects.delete(objectPath);
