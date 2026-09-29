import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings: Record<string, unknown> = {};
vi.mock("@/lib/env", () => ({ env: () => settings }));

type Call = { method: string; url: URL; headers: Headers };

let calls: Call[];
let answers: Array<(call: Call) => Response>;

beforeEach(() => {
  Object.assign(settings, { r2Endpoint: "https://acct.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret", STORAGE_BUCKET: "suzu-private" });
  calls = [];
  answers = [];
  vi.stubGlobal("fetch", async (input: Request) => {
    const call = { method: input.method, url: new URL(input.url), headers: input.headers };
    calls.push(call);
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected ${call.method} ${call.url}`);
    return answer(call);
  });
  // The module keeps its client; every test starts with a fresh one.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it("refuses to run without the bucket's keys", async () => {
    settings.R2_SECRET_ACCESS_KEY = undefined;
    const { createSignedUploadUrl, StorageError } = await import("./storage");
    await expect(createSignedUploadUrl("a", "application/pdf")).rejects.toMatchObject({ constructor: StorageError, message: "storage_not_configured" });
  });
});

describe("createSignedUploadUrl", () => {
  it("presigns a two-hour PUT on the bucket's path that only accepts the announced type", async () => {
    const { createSignedUploadUrl } = await import("./storage");
    const url = new URL(await createSignedUploadUrl("person_document/2026/a b.pdf", "application/pdf"));
    expect(`${url.origin}${url.pathname}`).toBe("https://acct.r2.cloudflarestorage.com/suzu-private/person_document/2026/a%20b.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("7200");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // Signing happens locally: nothing is sent.
    expect(calls).toHaveLength(0);
  });
});

describe("putObject", () => {
  it("writes once under the file's download name, never over an existing object", async () => {
    answers.push(() => new Response(null, { status: 200 }));
    const { putObject } = await import("./storage");
    await putObject("cv/2026/x.pdf", new Uint8Array([1, 2]), "application/pdf", "Hồ sơ.pdf");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].headers.get("if-none-match")).toBe("*");
    expect(calls[0].headers.get("content-type")).toBe("application/pdf");
    expect(calls[0].headers.get("content-disposition")).toBe(`attachment; filename="Ho so.pdf"; filename*=UTF-8''H%E1%BB%93%20s%C6%A1.pdf`);
    expect(calls[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("names a file the storage refused for its size", async () => {
    answers.push(() => new Response("<Error><Code>EntityTooLarge</Code></Error>", { status: 413 }));
    const { putObject, StorageError } = await import("./storage");
    await expect(putObject("a", new Uint8Array([1]), "application/pdf", "a.pdf")).rejects.toMatchObject({ constructor: StorageError, message: expect.stringContaining("file_storage_limit") });
  });
});

describe("inspectObject", () => {
  it("reads the first bytes and the full size from the range answer", async () => {
    answers.push(() => new Response(new Uint8Array(512).fill(7), { status: 206, headers: { "content-range": "bytes 0-511/12345" } }));
    const { inspectObject } = await import("./storage");
    const stored = await inspectObject("a");
    expect(calls[0].headers.get("range")).toBe("bytes=0-511");
    expect(stored?.sizeBytes).toBe(12_345);
    expect(stored?.head).toHaveLength(512);
  });

  it("says null when nothing was uploaded", async () => {
    answers.push(() => new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }));
    const { inspectObject } = await import("./storage");
    expect(await inspectObject("a")).toBeNull();
  });
});

describe("finalizeObject", () => {
  it("copies the object onto itself with its type and download name replaced", async () => {
    answers.push(() => new Response("<CopyObjectResult/>", { status: 200 }));
    const { finalizeObject } = await import("./storage");
    await finalizeObject("task/2026/a b.png", "image/png", "Ảnh.png");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url.pathname).toBe("/suzu-private/task/2026/a%20b.png");
    expect(calls[0].headers.get("x-amz-copy-source")).toBe("/suzu-private/task/2026/a%20b.png");
    expect(calls[0].headers.get("x-amz-metadata-directive")).toBe("REPLACE");
    expect(calls[0].headers.get("content-disposition")).toContain("filename*=UTF-8''%E1%BA%A2nh.png");
  });
});

describe("createSignedDownloadUrl and removeObject", () => {
  it("presigns a GET for exactly the time asked", async () => {
    const { createSignedDownloadUrl } = await import("./storage");
    const url = new URL(await createSignedDownloadUrl("a.pdf", 60));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("treats an object that is already gone as removed", async () => {
    answers.push(() => new Response(null, { status: 404 }));
    const { removeObject } = await import("./storage");
    await expect(removeObject("a")).resolves.toBeUndefined();
  });
});

describe("attachmentDisposition", () => {
  it("keeps quotes and backslashes out of the plain name", async () => {
    const { attachmentDisposition } = await import("./storage");
    expect(attachmentDisposition('a"b\\c.pdf')).toBe(`attachment; filename="a_b_c.pdf"; filename*=UTF-8''a%22b%5Cc.pdf`);
    expect(attachmentDisposition("Đơn (1).pdf")).toBe(`attachment; filename="Don (1).pdf"; filename*=UTF-8''%C4%90%C6%A1n%20%281%29.pdf`);
  });
});
