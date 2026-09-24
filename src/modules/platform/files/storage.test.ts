import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: () => ({ SUPABASE_URL: "http://storage.test", supabaseSecretKey: "secret", STORAGE_BUCKET: "suzu-private" }) }));

type Call = { method: string; path: string; body: unknown };

let calls: Call[];
let answers: Array<(call: Call) => Response>;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call = { method: init.method ?? "GET", path: url.replace("http://storage.test/storage/v1", ""), body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(call);
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected ${call.method} ${call.path}`);
    return answer(call);
  });
  // The module remembers that the bucket is ready; every test starts with a fresh memory.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const signed = () => json(200, { url: "/object/upload/sign/suzu-private/a?token=t" });

describe("ensureBucket", () => {
  it("leaves a bucket alone that already has no size limit of its own", async () => {
    answers.push(() => json(200, { id: "suzu-private", public: false, file_size_limit: null }), signed);
    const { createSignedUploadUrl } = await import("./storage");
    await expect(createSignedUploadUrl("a")).resolves.toBe("http://storage.test/storage/v1/object/upload/sign/suzu-private/a?token=t");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /bucket/suzu-private", "POST /object/upload/sign/suzu-private/a"]);
  });

  it("lifts a bucket-level limit, which could only be lower than the project's", async () => {
    answers.push(() => json(200, { id: "suzu-private", public: false, file_size_limit: 20 * 1024 * 1024 }), () => json(200, { message: "Successfully updated" }), signed);
    const { createSignedUploadUrl } = await import("./storage");
    await createSignedUploadUrl("a");
    expect(calls[1]).toEqual({ method: "PUT", path: "/bucket/suzu-private", body: { public: false, file_size_limit: null } });
  });

  it("creates a missing bucket private and without a limit of its own", async () => {
    answers.push(() => json(404, { statusCode: "404", error: "Bucket not found" }), () => json(200, { name: "suzu-private" }), signed);
    const { createSignedUploadUrl } = await import("./storage");
    await createSignedUploadUrl("a");
    expect(calls[1]).toEqual({ method: "POST", path: "/bucket", body: { id: "suzu-private", name: "suzu-private", public: false, file_size_limit: null } });
  });

  it("tolerates losing the race to create it", async () => {
    answers.push(() => json(404, {}), () => json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists", code: "BucketAlreadyExists" }), signed);
    const { createSignedUploadUrl } = await import("./storage");
    await expect(createSignedUploadUrl("a")).resolves.toBeTruthy();
  });

  it("checks once per process, not once per upload", async () => {
    answers.push(() => json(200, { id: "suzu-private", public: false, file_size_limit: null }), signed, signed);
    const { createSignedUploadUrl } = await import("./storage");
    await createSignedUploadUrl("a");
    await createSignedUploadUrl("b");
    expect(calls.filter((call) => call.path.startsWith("/bucket"))).toHaveLength(1);
  });
});

describe("putObject", () => {
  it("names a file the storage refused for its size", async () => {
    answers.push(() => json(200, { id: "suzu-private", public: false, file_size_limit: null }), () => json(413, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size", code: "EntityTooLarge" }));
    const { putObject, StorageError } = await import("./storage");
    await expect(putObject("a", new Uint8Array([1]), "application/pdf")).rejects.toMatchObject({ constructor: StorageError, message: expect.stringContaining("file_storage_limit") });
  });
});
