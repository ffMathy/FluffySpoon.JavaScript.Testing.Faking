// R12FE-4 / R12TD-1 Pins of documented limitations with Node.js' typings, as the project's @types/node (18.19.x)
// declares them. The same holds for @types/node 18.19.63 and later 18.x, 20.11.21 and later 20.x, 22.x and 24.x. From
// @types/node 25.0.0 on, `EventEmitter`, `http.Server` and `net.Socket` declare their events with generic methods
// (`emit<E extends string | symbol>(eventName: EventNames<T, E>, ...args: Args<T, E>)`, `on<E extends keyof
// ServerEventMap>(...)`), and on a substitute, with the type parameters replaced by their constraints, every event
// name and any arguments compile (see the README, Typing limitations).
//
// More than 8 overloads: only the last 8 have the setup API. `http.Server` declares 12 overloads of `on()` and
// `once()`: any event name, then 'close', 'connection', 'error', 'listening', 'checkContinue', 'checkExpectation',
// 'clientError', 'connect', 'dropRequest', 'request', 'upgrade'. So 'close', 'connection' and 'error' cannot be
// configured one at a time. Configuring every event at once always compiles, and checks work with every overload.
import * as http from 'http'
import * as net from 'net'
import { Arg, Substitute, configure, received } from '../src'

const server = Substitute.for<http.Server>()
server[configure]().on('request', Arg.any()).returns(server)
server[configure]().on('listening', Arg.any()).returns(server)
server[configure]().once('upgrade', Arg.any()).returns(server)
// @ts-expect-error 'error' is not among the last 8 overloads
server[configure]().on('error', Arg.any()).returns(server)
// @ts-expect-error neither is 'close'
server[configure]().on('close', Arg.any()).returns(server)
// @ts-expect-error nor 'connection'
server[configure]().on('connection', Arg.any()).returns(server)
// @ts-expect-error once() has the same overloads
server[configure]().once('error', Arg.any()).returns(server)
// @ts-expect-error nor the first overload, for any event name
server[configure]().on(Arg.any('string'), Arg.any()).returns(server)

// The forms that always compile: every event at once, ...
server[configure]().on(Arg.all()).returns(server)
server[configure]().once(Arg.all()).returns(server)
// ... or a mimicks that switches on the event name, to capture a listener
const listeners: { [event: string]: (...args: any[]) => void } = {}
server[configure]().on(Arg.all()).mimicks((event: string | symbol, listener: (...args: any[]) => void) => {
  listeners[String(event)] = listener
  return server
})
// Checks work with every overload.
server.received(1).on('error', Arg.any())
server.received(1).on('close', Arg.any())
server[received](1).once('connection', Arg.any())
server.received(1).on(Arg.any('string'), Arg.any())

// net.Socket declares 10 overloads with @types/node 18 (only 'close' comes too early) and 13 with @types/node 22 and
// 24 ('close', 'connect', 'connectionAttempt' and 'connectionAttemptFailed' come too early).
const socket = Substitute.for<net.Socket>()
socket[configure]().on('data', Arg.any()).returns(socket)
socket[configure]().on('error', Arg.any()).returns(socket)
// @ts-expect-error 'close' is not among the last 8 overloads
socket[configure]().on('close', Arg.any()).returns(socket)
socket[configure]().on(Arg.all()).returns(socket)
socket.received(1).on('close', Arg.any())
