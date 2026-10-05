import { afterEach, describe, expect, it } from "vitest";
import { withModestMemory } from "./wasm-memory";

const Real = WebAssembly.Memory;
const PAGES_PER_MB = 16;

/** A browser that refuses a shared memory whose ceiling is above `limit` megabytes, as iPadOS 17 does. */
function refuseAbove(limit: number): WebAssembly.MemoryDescriptor[] {
  const asked: WebAssembly.MemoryDescriptor[] = [];
  WebAssembly.Memory = new Proxy(Real, {
    construct(target, [descriptor]: [WebAssembly.MemoryDescriptor]) {
      asked.push(descriptor);
      if (descriptor.shared && (descriptor.maximum ?? 0) > limit * PAGES_PER_MB) throw new RangeError("Out of memory");
      return new target(descriptor);
    },
  });
  return asked;
}

afterEach(() => {
  WebAssembly.Memory = Real;
});

describe("withModestMemory", () => {
  const runtime = { initial: 256, maximum: 65536, shared: true };

  it("leaves a request the browser grants as it was asked", async () => {
    const asked = refuseAbove(4096);
    const memory = await withModestMemory(async () => new WebAssembly.Memory(runtime));
    expect(asked).toEqual([runtime]);
    expect(memory.buffer.byteLength).toBe(256 * 65536);
  });

  it("asks a refused request again with a lower ceiling, largest first", async () => {
    const asked = refuseAbove(512);
    const memory = await withModestMemory(async () => new WebAssembly.Memory(runtime));
    expect(asked.map((descriptor) => descriptor.maximum)).toEqual([65536, 1024 * PAGES_PER_MB, 512 * PAGES_PER_MB]);
    expect(memory).toBeInstanceOf(Real);
    expect(memory.buffer).toBeInstanceOf(SharedArrayBuffer);
  });

  it("gives the browser's own refusal when no ceiling is low enough", async () => {
    refuseAbove(8);
    await expect(withModestMemory(async () => new WebAssembly.Memory(runtime))).rejects.toThrow("Out of memory");
  });

  it("does not touch a memory that is not shared, nor another kind of error", async () => {
    refuseAbove(512);
    await expect(withModestMemory(async () => new WebAssembly.Memory({ initial: 2, maximum: 1 }))).rejects.toThrow(RangeError);
    const plain = await withModestMemory(async () => new WebAssembly.Memory({ initial: 1, maximum: 65536 }));
    expect(plain.buffer.byteLength).toBe(65536);
  });

  it("puts WebAssembly.Memory back, also when the start fails", async () => {
    const stub = WebAssembly.Memory;
    await expect(withModestMemory(async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(WebAssembly.Memory).toBe(stub);
  });
});
