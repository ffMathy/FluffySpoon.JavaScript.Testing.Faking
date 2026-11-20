'use strict'
// Which deep imports of compiled files (`@fluffy-spoon/substitute/dist/<path>`) a Node.js version resolves.
// Deep imports are not public API, but the "exports" map keeps them working where Node.js can:
//
// - older than 12.17: "exports" is ignored, so both forms work;
// - 12.17 to 12.19, all of 13.x and 14.0 to 14.12: "exports" without subpath patterns, so both forms fail;
// - 12.20 to 12.22, 14.13 to 14.18 and 16.0 to 16.8: subpath patterns without trailers, so only the form without
//   `.js` works (through the "./dist/*" subpath);
// - 14.19 or newer on 14.x, 16.9 or newer, and every later version: pattern trailers ("./dist/*.js"), both forms work.
//
// 15.x is not listed: nobody checked it, so deep-imports.js does not assert anything about it.
// CONTRIBUTING.md and MIGRATION.md ("Imports and packaging") say the same; packaging/package.test.js checks that they
// agree with this table, and deep-imports.js checks the table against the Node.js version it runs on.
// Kept to syntax that the oldest supported Node version understands (see engines in package.json).

/**
 * @param {string} version A Node.js version such as `v14.18.0` (process.version) or `14.18.0`.
 * @returns {{ withoutExtension: boolean, withExtension: boolean } | undefined} Whether
 *   `@fluffy-spoon/substitute/dist/api/Arg` and `@fluffy-spoon/substitute/dist/api/Arg.js` resolve, or undefined for
 *   a version nobody checked.
 */
function deepImportSupport (version) {
  var parts = String(version).replace(/^v/, '').split('.')
  var major = Number(parts[0])
  var minor = Number(parts[1])
  var atLeast = function (wantedMajor, wantedMinor) {
    return major > wantedMajor || (major === wantedMajor && minor >= wantedMinor)
  }
  var support = function (withoutExtension, withExtension) {
    return { withoutExtension: withoutExtension, withExtension: withExtension }
  }
  if (!atLeast(12, 17)) return support(true, true)
  if (major === 12) return support(atLeast(12, 20), false)
  if (major === 13) return support(false, false)
  if (major === 14) return support(atLeast(14, 13), atLeast(14, 19))
  if (major === 15) return undefined
  if (major === 16) return support(true, atLeast(16, 9))
  return support(true, true)
}

module.exports = { deepImportSupport: deepImportSupport }
