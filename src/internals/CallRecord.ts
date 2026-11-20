import { Frame, StackHolder, frameOfStack, sameExpression, sameLineAfter, stackText } from './CallSite'

export type RecordKind = 'get' | 'set' | 'call'

/**
 * A global, monotonically increasing operation counter. Every record that is created or converted takes
 * the next number. It lets the engine recognise that two operations are adjacent, which is how an
 * expression such as `sub.a.b(1).returns(2)` is recognised as one setup chain.
 */
let sequence = 0
export const currentSequence = (): number => sequence
const nextSequence = (): number => ++sequence

/**
 * One received interaction with a substitute: a property read, a property assignment or an invocation.
 * A property read whose result is then invoked is converted into the invocation (reading a method in
 * order to call it is not a property read).
 */
export class CallRecord {
  public seq: number
  public retracted = false
  /** The captured stack (its call site), formatted as text only when a message shows it (E4). */
  private _stack: StackHolder
  /**
   * D26: an invocation through `x.call(...)` / `x.apply(...)` is recorded once, with two readings: a call of x's
   * member `call` / `apply` with the raw arguments, and a direct call of x. Each reading is a record of its own
   * substitute and member, so that assertions match either one, and each one points to the other. Retracting one
   * retracts both. (Left undeclared on ordinary records, which then do not carry the fields.)
   */
  public twin?: CallRecord
  /** True on the direct-call reading of such an invocation. */
  public directReading?: boolean
  /** E23: true when the invocation was a construction (`new sub.Client(url)`), which messages show with `new`. */
  public constructed?: boolean
  /**
   * E111: true when the operation answered with the substitute it was made on itself, which a setup with matchers or the
   * mimicked instance gives every call it matches (`io.to(Arg.any()).returns(io)`): only an operation on the same line
   * continues its expression then (see the engine's continuesExpression).
   */
  public handedOutItself?: boolean
  /** The record of the previous step when this one continues an expression chain (`a.b().c`), see chainPrevious. */
  private _chainPrevious: CallRecord | undefined
  /**
   * E126 (R17-ADV-11): the previous step when it is a hand-out of the substitute itself (handedOutItself), whose link is
   * decided when it is first used (see chainPrevious and linkToSelfHandOut). (Left undeclared on other records.)
   */
  private _selfHandOut?: CallRecord

  constructor(
    public kind: RecordKind,
    public readonly key: PropertyKey,
    public args: any[] | undefined,
    /** The captured call site (CallSite.captureStack), taken by the trap of the operation. */
    site: StackHolder
  ) {
    this._chainPrevious = undefined
    this.seq = nextSequence()
    this._stack = site
  }

  /**
   * The record of the previous step when this one continues an expression chain (`a.b().c`). E126: a link to a hand-out
   * of the substitute itself is decided here, when a setup or a check first follows the chain back (see
   * linkToSelfHandOut), from where both operations are (see continuesSelfHandOut).
   */
  public get chainPrevious(): CallRecord | undefined {
    const candidate = this._selfHandOut
    if (candidate !== undefined) {
      this._selfHandOut = undefined
      // (the candidate's frame first, as linkChain reads them)
      const from = candidate.frame
      if (continuesSelfHandOut(from, this.frame)) this._chainPrevious = candidate
    }
    return this._chainPrevious
  }

  public set chainPrevious(previous: CallRecord | undefined) {
    if (this._selfHandOut !== undefined) this._selfHandOut = undefined
    this._chainPrevious = previous
  }

  /**
   * E126 (R17-ADV-11): this operation came right after a hand-out of the substitute itself (`candidate`, a fluent
   * `return this` of a mimicked instance, `map.set(Arg.all()).returns(map)`), and continues its expression only when it
   * is on the same line, after it (E111, see continuesSelfHandOut). Which it is, is decided only when a setup or a check
   * follows the chain back (see chainPrevious): the calls of a fluent method (`emitter.on('a', f).on('b', f)`) read no
   * stack frames until then, as before E111. (The frame of a read that is invoked later is then the invocation's, see
   * convertToCall: for `sub.method(...)` both are at the same place.)
   */
  public linkToSelfHandOut(candidate: CallRecord): void {
    this._chainPrevious = undefined
    this._selfHandOut = candidate
  }

  /** The captured call site itself (E48: the stack of a report about this operation). */
  public get site(): StackHolder {
    return this._stack
  }

  /** The call site as a stack trace text, for messages. */
  public get stack(): string | undefined {
    return stackText(this._stack)
  }

  /** The first frame outside the library (D25), or null when there is none. Reading it keeps the text (E11). */
  public get frame(): Frame | null {
    return frameOfStack(this._stack)
  }

  /**
   * Turns a property read into an invocation. E1/E8: the invocation is a call made where it is invoked, which is not
   * always where the method was read (a method reference handed to the code under test, `new Service(api.getUser)`,
   * is invoked later, elsewhere, even when the code under test invokes it on the substitute again, as
   * `Reflect.apply(fetch, api, [id])` does). So it always takes the call site of the invocation: when the read and the
   * invocation are the same expression (`sub.method(...)`), both are in the same function anyway.
   */
  public convertToCall(args: any[], site: StackHolder): void {
    this.kind = 'call'
    this.args = args
    this._stack = site
    this.seq = nextSequence()
  }
}

/**
 * Removes a record (and the chain of records that led to it) from the received calls, because the
 * expression turned out to be a setup or an assertion rather than a real use.
 */
export const retract = (record: CallRecord | undefined): void => {
  const pending: CallRecord[] = record === undefined ? [] : [record]
  while (pending.length > 0) {
    let current: CallRecord | undefined = pending.pop()
    while (current !== undefined && !current.retracted) {
      current.retracted = true
      if (current.twin !== undefined && !current.twin.retracted) pending.push(current.twin)
      current = current.chainPrevious
    }
  }
}

/**
 * E111 (R16-ADV-7): whether an operation at `frame` continues the expression of a hand-out of the substitute itself at
 * `from` (handedOutItself): only on the same line, after it, in the same function (E125: the same line of the source,
 * where Node.js has a source map, see CallSite.sameLineAfter). Such a substitute is where the next statement starts,
 * too (`server.on('close', listener)`, then `server.received(1).on('error', Arg.any())`), and a statement before it is no
 * part of its expression (E39). Without frames (Error.stackTraceLimit = 0) it never does.
 */
export const continuesSelfHandOut = (from: Frame | null, frame: Frame | null): boolean =>
  from !== null && frame !== null && sameExpression(from, frame) && sameLineAfter(from, frame)

/** D26: makes two records the member reading and the direct-call reading of one invocation. */
export const pairReadings = (memberReading: CallRecord, directReading: CallRecord): void => {
  memberReading.twin = directReading
  directReading.twin = memberReading
  directReading.directReading = true
}
