import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  target: "es2020",
  // React and the runtime stay external; everything else — the transport, the
  // chart renderer, the stylesheet — is bundled in from ../../src, so
  // installing this package pulls in nothing but itself.
  external: ["react", "react-dom", "react/jsx-runtime"],
})
