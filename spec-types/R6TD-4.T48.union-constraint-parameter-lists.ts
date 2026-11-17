// R6TD-4 / T48 (documented limitation) Generic code whose constraint is a union whose variants declare a method with
// different parameter lists: on TypeScript 5.4 and newer such a call has no setup API at all, also when every variant
// returns the same type (TypeScript computes the call from each variant of the constraint and pairs each variant's
// substitute signatures with the other variant's own method). TypeScript 5.0 and older compile it. The configure view
// and a cast to the constraint work on every version. (For different return types see limitations.ts.)
import { Substitute, SubstituteOf, configure } from '../src'

interface LogA { kind: 'a'; log(message: string): void }
interface LogB { kind: 'b'; log(message: string, level?: number): void }
export function stubLog<T extends LogA | LogB>(sub: SubstituteOf<T>) {
  // @ts-expect-error no setup API on TypeScript 5.4 and newer
  sub.log('x').returns()
  sub[configure]().log('x').returns()
  ;(sub as SubstituteOf<LogA | LogB>).log('x').returns()
  sub.received().log('x')
}

interface ClientV1 { version: 1; fetch(url: string): Promise<string> }
interface ClientV2 { version: 2; fetch(url: string, options?: { timeout: number }): Promise<string> }
export class Fixture<T extends ClientV1 | ClientV2> {
  sub = Substitute.for<T>()
  arrange() {
    // @ts-expect-error no setup API on TypeScript 5.4 and newer
    this.sub.fetch('/a').resolves('ok')
    this.sub[configure]().fetch('/a').resolves('ok')
    ;(this.sub as SubstituteOf<ClientV1 | ClientV2>).fetch('/a').resolves('ok')
  }
}
