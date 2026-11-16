export type RecordKind = 'get' | 'set' | 'call'

/**
 * A global, monotonically increasing operation counter. Every record that is created or converted takes
 * the next number. It lets the engine recognise that two operations are adjacent, which is how an
 * expression such as `sub.a.b(1).returns(2)` is recognised as one setup chain.
 */
let sequence = 0
export const currentSequence = (): number => sequence
const nextSequence = (): number => ++sequence

type StackHolder = { stack?: string }

const captureStack = (stackStart: Function): StackHolder => {
  const holder: StackHolder = {}
  if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(holder, stackStart)
  else holder.stack = new Error().stack
  return holder
}

/**
 * One received interaction with a substitute: a property read, a property assignment or an invocation.
 * A property read whose result is then invoked is converted into the invocation (reading a method in
 * order to call it is not a property read).
 */
export class CallRecord {
  public seq: number
  public retracted = false
  private _stackHolder: StackHolder

  constructor(
    public kind: RecordKind,
    public readonly key: PropertyKey,
    public args: any[] | undefined,
    stackStart: Function,
    /** The record of the previous step when this one continues an expression chain (`a.b().c`). */
    public readonly chainPrevious?: CallRecord
  ) {
    this.seq = nextSequence()
    this._stackHolder = captureStack(stackStart)
  }

  public get stack(): string | undefined {
    try {
      return this._stackHolder.stack
    } catch {
      return undefined
    }
  }

  /**
   * Turns a property read into an invocation. When the invocation directly follows the read (the usual
   * `sub.method(...)`), the read already captured the right call site.
   */
  public convertToCall(args: any[], stackStart: Function): void {
    const directlyInvoked = this.seq === currentSequence()
    this.kind = 'call'
    this.args = args
    if (!directlyInvoked) this._stackHolder = captureStack(stackStart)
    this.seq = nextSequence()
  }
}

/**
 * Removes a record (and the chain of records that led to it) from the received calls, because the
 * expression turned out to be a setup or an assertion rather than a real use.
 */
export const retract = (record: CallRecord | undefined): void => {
  let current = record
  while (current !== undefined && !current.retracted) {
    current.retracted = true
    current = current.chainPrevious
  }
}
