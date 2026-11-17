// Round 9 (E53): a barrel that re-exports the mailer module (TypeScript: __exportStar; Babel: a loop over Object.keys of the
// module, both copying the module's own enumerable keys).
export * from './mailer'
