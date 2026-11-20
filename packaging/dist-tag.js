'use strict'
// Prints the npm dist-tag for a release, and fails when the release tag does not match the package version.
//
//   node packaging/dist-tag.js <release tag> <package.json version> <release is marked as prerelease: true|false>
//
// - A stable version (2.0.1) published from a normal release is tagged `latest`.
// - A semver prerelease version (2.1.0-beta.1, 3.0.0-rc.1) or a GitHub release marked as prerelease is tagged `beta`,
//   so `npm install @fluffy-spoon/substitute` never picks it up by accident.
// Used by .github/workflows/npm-publish.yml.

const [tag, version, prerelease] = process.argv.slice(2)

const fail = message => {
  console.error(message)
  process.exit(1)
}

if (!tag || !version || !['true', 'false'].includes(prerelease)) {
  fail('usage: node packaging/dist-tag.js <release tag> <package.json version> <true|false>')
}

const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
const parsed = semver.exec(version)
if (parsed === null) fail(`package.json version ${version} is not a valid semver version`)

const tagVersion = tag.replace(/^v/, '')
if (tagVersion !== version) {
  fail(`The release tag ${tag} does not match the package.json version ${version}. Bump the version (npm version <x.y.z>) or fix the tag.`)
}

const isPrerelease = prerelease === 'true' || parsed[1] !== undefined
console.log(isPrerelease ? 'beta' : 'latest')
