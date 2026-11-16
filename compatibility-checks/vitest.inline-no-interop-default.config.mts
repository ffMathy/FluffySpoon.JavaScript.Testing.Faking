import { defineConfig } from 'vitest/config'

// PK4-2: like vitest.inline.config.mts (the package inlined), plus `deps.interopDefault: false`. vitest then hands the
// package's ES module entry an object with only some of the exports as the default import of its CommonJS build, and
// the named exports through the namespace, whose default is that object instead of the Substitute class. The entry
// once rejected that namespace and threw at import time. Used by test/bundlers.ts.
export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ['@fluffy-spoon/substitute']
      }
    },
    deps: {
      interopDefault: false
    }
  }
})
