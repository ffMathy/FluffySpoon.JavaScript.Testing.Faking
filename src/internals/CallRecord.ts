import { StackHolder, captureStack, forgetHandOutFrame, stackText } from './CallSite'

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

  constructor(
    public kind: RecordKind,
    public readonly key: PropertyKey,
    public args: any[] | undefined,
    stackStart: Function,
    /** The record of the previous step when this one continues an expression chain (`a.b().c`). */
    public chainPrevious?: CallRecord
  ) {
    this.seq = nextSequence()
    this._stack = captureStack(stackStart)
  }

  /** The call site as a stack trace text, for messages. */
  public get stack(): string | undefined {
    return stackText(this._stack)
  }

  /**
   * Turns a property read into an invocation. E1: the invocation is a call made where it is invoked, which is not
   * always where the method was read (a method reference handed to the code under test, `new Service(api.getUser)`,
   * is invoked later, elsewhere), so it takes the call site of the invocation, unless the caller knows that the read
   * and the invocation are the same expression (`sub.method(...)`).
   */
  public convertToCall(args: any[], stackStart: Function, sameExpressionAsRead = false): void {
    this.kind = 'call'
    this.args = args
    if (!sameExpressionAsRead) {
      this._stack = captureStack(stackStart)
      forgetHandOutFrame(this)
    }
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
