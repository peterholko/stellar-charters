import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The engine (`src/engine`) is authored in NodeNext style: its internal imports use
 * explicit `.js` specifiers that actually point at `.ts` files. Vite/esbuild won't
 * rewrite those by default, so this tiny resolver maps a relative `*.js` import to its
 * `*.ts` sibling when one exists — letting the web client import the pure engine source
 * unchanged (as the README intends).
 */
const engineDir = fileURLToPath(new URL("../src/engine/", import.meta.url));

function engineJsToTs(): Plugin {
  return {
    name: "engine-js-to-ts",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (
        importer &&
        // ONLY rewrite imports made *from* the pure engine source tree. That is the only
        // place that uses NodeNext `.js` specifiers pointing at `.ts`. Crucially this never
        // touches Vite's pre-bundled deps (`node_modules/.vite/deps/chunk-*.js`), whose
        // internal imports must be left alone or the optimizer breaks.
        importer.startsWith(engineDir) &&
        source.endsWith(".js") &&
        (source.startsWith("./") || source.startsWith("../"))
      ) {
        const resolved = await this.resolve(source.slice(0, -3) + ".ts", importer, {
          ...options,
          skipSelf: true,
        });
        if (resolved) return resolved;
      }
      return null;
    },
  };
}

const root = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root,
  plugins: [engineJsToTs(), react()],
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("../src/engine/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The engine and scenario JSON live outside web/ (the Vite root); allow reading them.
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  preview: {
    port: 4173,
  },
});
