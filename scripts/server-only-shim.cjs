// Lets a seed script call the app's own services (which `import "server-only"`) from plain Node:
// `tsx --require ./scripts/server-only-shim.cjs scripts/<seed>.ts`. The marker package resolves to
// its empty build — what Next itself does for server code (the "react-server" condition) — without
// turning on that condition for React, which modules importing next/navigation still need.
const Module = process.getBuiltinModule("node:module");
const path = process.getBuiltinModule("node:path");

const empty = path.join(path.dirname(Module.createRequire(__filename).resolve("server-only")), "empty.js");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "server-only" ? empty : resolve.call(this, request, ...rest);
};
