// R11TD-1 / T66: `Arg.any('string')`, `Arg.any('number')` and `Arg.any('boolean')` are typed as their primitive type
// again (as at 4b1fa69), so overload resolution is as at 4b1fa69: a type matcher does not pick an overload whose
// parameter is a literal type or a `K extends keyof ...Map` key, and gets the setup API of the overload for any string
// (Node stream/process/child_process `on`/`once`, lib.dom querySelector/querySelectorAll/closest/getElementsByTagName/
// getContext, keyed getters, literal overloads). R11FE-2: the encoding parameter of an overloaded fs.readFile.
import { Readable } from 'stream'
import { ChildProcess } from 'child_process'
import { Server } from 'http'
import { Arg, Substitute, configure, received } from '../src'
import { assert, Equals } from './helpers'

interface User { id: number; name: string }
interface Base { id: number }
interface Repo {
  create(kind: 'user'): User
  create(kind: string): Base
}
const repo = Substitute.for<Repo>()
const base: Base = { id: 1 }
repo.create(Arg.any('string')).returns(base)
repo[configure]().create(Arg.any('string')).returns(base)
repo.create('x').returns(base)
repo.received(1).create(Arg.any('string'))
repo[received](1).create(Arg.any('string'))
// @ts-expect-error `create('user')` returns a User
repo.create('user').returns(base)

// lib.dom
const doc = Substitute.for<Document>()
const el = Substitute.for<HTMLElement>()
doc.createElement(Arg.any('string')).returns(el)
doc.createElement('my-widget').returns(el)
doc.getElementsByTagName(Arg.any('string')).returns(Substitute.for<HTMLCollectionOf<Element>>())
doc.querySelector(Arg.any('string')).returns(el)
doc.querySelector(Arg.any('string')).returns(null)
doc.querySelector(Arg.any('string')).returns(Substitute.for<Element>())
doc.querySelectorAll(Arg.any('string')).returns(Substitute.for<NodeListOf<Element>>())
doc[configure]().querySelector(Arg.any('string')).returns(Substitute.for<Element>())
doc.received(1).querySelector(Arg.any('string'))
el.closest(Arg.any('string')).returns(Substitute.for<Element>())
el.getElementsByTagName(Arg.any('string')).returns(Substitute.for<HTMLCollectionOf<Element>>())
const canvas = Substitute.for<HTMLCanvasElement>()
canvas.getContext(Arg.any('string')).returns(null)
const win = Substitute.for<Window>()
win.addEventListener(Arg.any('string'), Arg.any()).returns()
// @ts-expect-error querySelector of any string returns an Element or null
doc.querySelector(Arg.any('string')).returns(5)

// Node: streams, child processes, servers and the process all overload `on`/`once` with literal event names.
const stream = Substitute.for<Readable>()
stream.on(Arg.any('string'), Arg.any()).returns(stream)
stream.once(Arg.any('string'), Arg.any()).returns(stream)
stream[configure]().on(Arg.any('string'), Arg.any()).returns(stream)
stream.received().on(Arg.any('string'), Arg.any())
const child = Substitute.for<ChildProcess>()
child.on(Arg.any('string'), Arg.any('function')).returns(child)
const server = Substitute.for<Server>()
server.listen(Arg.any('number')).returns(server)
const proc = Substitute.for<NodeJS.Process>()
proc.on(Arg.any('string'), Arg.any()).returns(proc)
// @ts-expect-error `on` returns the stream
stream.on(Arg.any('string'), Arg.any()).returns(5)

interface Ev {
  on(event: 'close', cb: () => void): this
  on(event: 'data', cb: (chunk: Uint8Array) => void): this
  on(event: string, cb: (...args: any[]) => void): this
}
const ev = Substitute.for<Ev>()
ev.on(Arg.any('string'), Arg.any()).returns(ev)
ev.on(Arg.any('string'), (a: number, b: string) => { }).returns(ev)

// Keyed getters and literal overloads.
interface Store {
  get(key: 'count'): number
  get(key: string): string | undefined
}
const store = Substitute.for<Store>()
store.get(Arg.any('string')).returns('x')
store.get(Arg.any('string')).returns(undefined)
store.received().get(Arg.any('string'))
const value = store.get(Arg.any('string'))
assert<Equals<Parameters<typeof value.returns>[0], string | undefined>>()
// @ts-expect-error `get` of any string returns a string or undefined
store.get(Arg.any('string')).returns(1)

interface Codes { code(c: 200): 'ok'; code(c: number): string; flag(on: true): 1; flag(on: boolean): number }
const codes = Substitute.for<Codes>()
codes.code(Arg.any('number')).returns('x')
codes.flag(Arg.any('boolean')).returns(5)
// @ts-expect-error `code` of any number returns a string
codes.code(Arg.any('number')).returns(5)

// R11FE-2: Node's overloaded fs.readFile(path, options). The encoding parameter is a union of string literals (or an
// options object) in every overload, so a string matcher does not fit it (T64 is reverted, see
// R9FE-3.T64.arg-any-primitive-subtypes.ts). A literal encoding or `Arg.any('string') as Enc` does; `Arg.any()` does in
// a check, but in a setup it picks the FIRST overload (whose value is a Uint8Array), as any argument of type `any` does.
type Enc = 'utf8' | 'hex' | 'base64'
interface Files {
  readFile(p: string, o?: { encoding?: null } | null): Uint8Array
  readFile(p: string, o: { encoding: Enc } | Enc): string
  readFile(p: string, o?: { encoding?: Enc | null } | Enc | null): string | Uint8Array
}
const files = Substitute.for<Files>()
// @ts-expect-error the encoding is a union of string literals (R11FE-2)
files.readFile('/x', Arg.any('string')).returns('a')
// @ts-expect-error likewise in a check (R11FE-2)
files.received(1).readFile(Arg.any(), Arg.any('string'))
// @ts-expect-error likewise in an options object (R11FE-2)
files.readFile('/x', { encoding: Arg.any('string') }).returns('a')
files.readFile('/x', Arg.any()).returns(new Uint8Array(0))
// @ts-expect-error `Arg.any()` picks the first overload, whose value is a Uint8Array
files.readFile('/x', Arg.any()).returns('a')
files.readFile('/x', 'utf8').returns('a')
files.received(1).readFile(Arg.any(), Arg.any())
files.received(1).readFile(Arg.any(), 'utf8')
files.readFile('/x', { encoding: 'utf8' }).returns('a')
files.readFile('/x', Arg.any('string') as Enc).returns('a')
files.readFile('/x', Arg.is((o: Enc) => o !== 'hex')).returns('a')
