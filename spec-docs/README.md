# Documentation check

`npm run test:docs` builds the package and checks every code example in [README.md](../README.md),
[MIGRATION.md](../MIGRATION.md) and [CHANGELOG.md](../CHANGELOG.md), so the documentation cannot drift away from the
library:

* ```` ```typescript ```` / ```` ```ts ```` blocks are type-checked under `strict` against the built package (resolved
  through `package.json` like an installed copy, so the `exports` map and the published typings are what is checked),
  and then run with Node.js, one process per block.
* ```` ```js ```` / ```` ```javascript ```` blocks are run with Node.js.
* Every block must have a language tag. Blocks in other languages (`sh`, `text`, ...) are not checked.
* Relative links must point to an existing file, and `#anchors` to an existing heading.

It takes a few seconds. Then `spec-docs/self-test.js` runs the check on [fixtures/broken.md](fixtures/broken.md), whose
code blocks and links are broken on purpose, and fails if the check does not report each of them.

## Writing examples
Promise what the code does in a comment, and the check holds the example to it:

```ts
console.log(calculator.add(1, 2)) // prints 3
calculator.received(2).add(1, 2) // throws SubstituteException
calculator.received(-1).add(1, 2) // throws SubstituteException: Expected count has to be a non-negative integer
```

* `console.log(...) // prints <text>`: the line must print exactly `<text>` (the `util.format` output, as console.log
  prints it), exactly once. It also works inside a callback: `.then(value => console.log(value)) // prints 4`.
* `<statement> // throws <ErrorName>` or `// throws <ErrorName>: <text>`: the statement must throw an error with that
  `name`, whose message contains `<text>`. It must be a complete statement on one line.
* A `console.log` without `// prints` fails the check, and so does any exception, uncaught exception, unhandled rejection
  or non-zero exit code that the example does not promise.

Blocks can be marked with an HTML comment right before the fence (several directives are separated by spaces):

| Directive | Meaning |
|---|---|
| `<!-- docs-check: name=calculator -->` | Other blocks can use this block's code. Such a block must not contain `// prints` or `// throws`. |
| `<!-- docs-check: uses=calculator -->` | Runs the named blocks' code first (and the code they use in turn), in the same module. Every block gets its own fresh copy. Several names are separated by commas. |
| `<!-- docs-check: compile-only -->` | Only type-checked, for example code that needs a test runner. |
| `<!-- docs-check: esm -->` | An ES module (`.mts` / `.mjs`) instead of CommonJS. |
| `<!-- docs-check: uncaught=SubstituteException -->` | The block must end with that uncaught exception (a check reported later, from a microtask). |
| `<!-- docs-check: error-message -->` | On a ```` ```text ```` block: must equal `<name>: <message>` of the error thrown by the last `// throws` line of the checked block before it. Lines starting with `called at` match any stack frame. |
| `<!-- docs-check: skip <reason> -->` | Not checked at all: code for an old version, or deliberately partial code. |

Use `// @ts-expect-error` to show code that must not compile. To debug a failure, keep the generated files:

```sh
npm run build && node spec-docs/check.js --keep README.md
```
