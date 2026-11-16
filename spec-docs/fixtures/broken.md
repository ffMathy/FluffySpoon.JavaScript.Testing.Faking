# Fixture for spec-docs/self-test.js

Every code block below is broken on purpose. `<!-- self-test: expect=<text> -->` says which problem the docs check must
report for the block (a substring of the message); `expect=pass` marks the control blocks that must pass.

<!-- self-test: expect=pass -->
<!-- docs-check: name=calculator -->
```typescript
import { Substitute, Arg } from '@fluffy-spoon/substitute'

interface Calculator {
  add(a: number, b: number): number
  isEnabled: boolean
}

const calculator = Substitute.for<Calculator>()
```

<!-- self-test: expect=pass -->
<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2).returns(3)
console.log(calculator.add(1, 2)) // prints 3
calculator.received(1).add(1, 2)
calculator.received(2).add(1, 2) // throws SubstituteException: Expected to receive 2 method calls
```

A type error:

<!-- self-test: expect=Argument of type 'string' is not assignable to parameter of type 'number' -->
<!-- docs-check: uses=calculator -->
```typescript
calculator.add('1', 2).returns(3)
```

The README text and the runtime disagree about a printed value:

<!-- self-test: expect=expected to print "4", but printed "3" -->
<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2).returns(3)
console.log(calculator.add(1, 2)) // prints 4
```

The README promises an exception that does not happen:

<!-- self-test: expect=expected to throw SubstituteException, but it did not throw -->
<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2)
calculator.received(1).add(1, 2) // throws SubstituteException
```

The wrong exception:

<!-- self-test: expect=expected to throw SubstituteException, but it threw Error: boom -->
<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2).throws(new Error('boom'))
calculator.add(1, 2) // throws SubstituteException
```

An exception the README does not mention:

<!-- self-test: expect=the snippet threw SubstituteException -->
<!-- docs-check: uses=calculator -->
```typescript
calculator.received().add(1, 2)
```

A line that never runs:

<!-- self-test: expect=expected to print "never", but the line printed nothing -->
<!-- docs-check: uses=calculator -->
```typescript
if (calculator.isEnabled === true) {
  console.log('never') // prints never
}
```

Output that is not checked:

<!-- self-test: expect=console.log(...) without a "// prints <output>" comment -->
<!-- docs-check: uses=calculator -->
```typescript
console.log(calculator.add(1, 2))
```

An assertion that is reported later, but the README does not say so:

<!-- self-test: expect=uncaught exception: SubstituteException -->
<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2)
calculator.add(1, 2)
calculator.add(1, 2)
calculator.received(2).add
```

The README says a failure is reported later, but it is not:

<!-- self-test: expect=expected an uncaught SubstituteException -->
<!-- docs-check: uses=calculator uncaught=SubstituteException -->
```typescript
calculator.add(1, 2)
calculator.received(1).add(1, 2)
```

An unhandled rejection:

<!-- self-test: expect=unhandled rejection: Error: nobody waits for this -->
```typescript
Promise.reject(new Error('nobody waits for this'))
```

Top-level await in a CommonJS module:

<!-- self-test: expect=error TS1309 -->
```typescript
await Promise.resolve(1)
```

A failing node:test test:

<!-- self-test: expect=exited with code 1 -->
```typescript
import { test } from 'node:test'
import * as assert from 'node:assert'

test('fails', () => {
  assert.strictEqual(1, 2)
})
```

A block that uses a block that does not exist:

<!-- self-test: expect=there is no block named "calculater" -->
<!-- docs-check: uses=calculater -->
```typescript
calculator.add(1, 2)
```

An unknown directive:

<!-- self-test: expect=unknown docs-check directive "compileonly" -->
<!-- docs-check: compileonly -->
```typescript
const value = 1
```

A code block without a language:

<!-- self-test: expect=code block without a language tag -->
```
const value = 1
```

`// prints` without console.log:

<!-- self-test: expect="// prints" needs a console.log(...) call on the same line -->
<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2) // prints 3
```

An ES module that cannot import a name:

<!-- self-test: expect=does not provide an export named 'Mock' -->
<!-- docs-check: esm -->
```js
import { Mock } from '@fluffy-spoon/substitute'
Mock.for()
```

An error message that does not match:

<!-- self-test: expect=pass -->
<!-- docs-check: uses=calculator -->
```typescript
calculator.add(1, 2)
calculator.received().add(3, 4) // throws SubstituteException
```

<!-- self-test: expect=error-message block does not match -->
<!-- docs-check: error-message -->
```text
SubstituteException: Call count mismatch in @Substitute.add:
Expected to receive 1 or more method calls matching add(3, 5), but received none.
All property or method calls to @Substitute.add received so far:
› ✘ @Substitute.add(1, 2)
    called at somewhere
```

Skipped blocks are not checked:

<!-- self-test: expect=pass -->
<!-- docs-check: skip deliberately invalid -->
```typescript
this is not TypeScript
```

Blocks can build on blocks that build on other blocks:

<!-- self-test: expect=pass -->
<!-- docs-check: name=configured uses=calculator -->
```typescript
calculator.add(1, 1).returns(2)
```

<!-- self-test: expect=pass -->
<!-- docs-check: uses=configured -->
```typescript
console.log(calculator.add(1, 1)) // prints 2
```

But not in a cycle:

<!-- self-test: expect=blocks cannot use each other in a cycle -->
<!-- docs-check: name=cycle-a uses=cycle-b -->
```typescript
const a = 1
```

<!-- self-test: expect=blocks cannot use each other in a cycle -->
<!-- docs-check: name=cycle-b uses=cycle-a -->
```typescript
const b = 2
```

Links are checked, too. These work: [the top of this file](#fixture-for-spec-docsself-testjs), [the README](../../README.md#usage) and `[not a link](in code)`.

<!-- self-test: next-line=has no heading with the anchor #no-such-heading -->
A link to [a heading that does not exist](#no-such-heading).

<!-- self-test: next-line=does not exist -->
A link to [a file that does not exist](MISSING.md).
