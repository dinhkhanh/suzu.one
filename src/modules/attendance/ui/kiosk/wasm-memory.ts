// ONNX Runtime's only WebAssembly build asks for a shared memory that may grow to 4 GB. WebKit
// before iOS 18 sets all of it aside at once, and a tablet on iPadOS 17 answers "RangeError: Out of
// memory" — in Safari and in Chrome alike, which is the same engine there. SFace needs a few tens
// of megabytes, so while the runtime starts, a refused request is asked again with a ceiling the
// tablet can give. A browser that grants the first request never comes here.

const PAGE = 64 * 1024;
/** What a refused request is asked again for, largest first: 1 GB, 512 MB, 256 MB. */
const CEILINGS = [1024, 512, 256].map((megabytes) => (megabytes * 1024 * 1024) / PAGE);

/** Runs `start` with `WebAssembly.Memory` standing in for itself as above, and puts it back after. */
export async function withModestMemory<T>(start: () => Promise<T>): Promise<T> {
  const Memory = WebAssembly.Memory;
  WebAssembly.Memory = new Proxy(Memory, {
    construct(target, [descriptor]: [WebAssembly.MemoryDescriptor]) {
      try {
        return new target(descriptor);
      } catch (error) {
        if (!(error instanceof RangeError) || !descriptor?.shared || !descriptor.maximum) throw error;
        for (const maximum of CEILINGS) {
          if (maximum >= descriptor.maximum || maximum < descriptor.initial) continue;
          try {
            return new target({ ...descriptor, maximum });
          } catch {
            // Still too much: the next ceiling down.
          }
        }
        throw error;
      }
    },
  });
  try {
    return await start();
  } finally {
    WebAssembly.Memory = Memory;
  }
}
