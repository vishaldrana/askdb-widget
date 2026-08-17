import { defineConfig } from "tsup"

export default defineConfig([
  {
    // The npm package, for anyone who would rather import it than paste a
    // script tag — a Next.js app, say, that wants the widget in a layout.
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    treeshake: true,
    target: "es2020",
  },
  {
    // The snippet's payload. IIFE so it runs on a page with no module
    // support and no bundler, minified because it is on somebody else's
    // critical path and they did not choose to be there.
    entry: { askdb: "src/global.ts" },
    format: ["iife"],
    globalName: "AskDBWidget",
    minify: true,
    treeshake: true,
    target: "es2018",
    dts: false,
    outExtension: () => ({ js: ".js" }),
  },
])
