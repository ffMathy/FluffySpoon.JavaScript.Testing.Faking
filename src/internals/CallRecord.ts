import { Frame, StackHolder, frameOfStack, stackText } from './CallSite'

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

  constructor(
    public kind: RecordKind,
    public readonly key: PropertyKey,
    public args: any[] | undefined,
    /** The captured call site (CallSite.captureStack), taken by the trap of the operation. */
    site: StackHolder,
    /** The record of the previous step when this one continues an expression chain (`a.b().c`). */
    public chainPrevious?: CallRecord
  ) {
    this.seq = nextSequence()
    this._stack = site
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

/** D26: makes two records the member reading and the direct-call reading of one invocation. */
export const pairReadings = (memberReading: CallRecord, directReading: CallRecord): void => {
  memberReading.twin = directReading
  directReading.twin = memberReading
  directReading.directReading = true
}
