import { defineConfig } from 'vitest/config'

// F1: with inlined dependencies, vitest transforms @fluffy-spoon/substitute itself instead of letting Node.js load it.
// Vite then applies the __esModule interop to the CommonJS build that the package's ES module entry wraps, which
// once made every export of the package undefined. `server.deps.inline: true` and `ssr.noExternal` behave the same.
// Used by `npm run validate:vitest-inline` and by test/bundlers.ts.
export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ['@fluffy-spoon/substitute']
      }
    }
  }
})
