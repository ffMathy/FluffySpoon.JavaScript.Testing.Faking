type FilterFunction<T> = (item: T) => boolean
type MapperFunction<T, R> = (item: T) => R
type Transformer<T, R> = { type: 'filter', fnc: FilterFunction<T> } | { type: 'mapper', fnc: MapperFunction<T, R> }

export class RecordsSet<T> extends Set<T> {
  private _transformer: Transformer<any, any>
  private _prevIter: RecordsSet<T>

  constructor(value?: Iterable<T> | readonly T[]) {
    super(value instanceof RecordsSet ? undefined : value)
    if (value instanceof RecordsSet) this._prevIter = value
  }

  filter(predicate: (item: T) => boolean): RecordsSet<T> {
    const newInstance = new RecordsSet<T>(this)
    newInstance._transformer = { type: 'filter', fnc: predicate }
    return newInstance
  }

  map<R>(predicate: (item: T) => R): RecordsSet<R> {
    const newInstance = new RecordsSet<R | T>(this)
    newInstance._transformer = { type: 'mapper', fnc: predicate }
    return newInstance as RecordsSet<R>
  }

  *[Symbol.iterator](): IterableIterator<T> {
    yield* this.values()
  }

  private *applyTransform(itarable: Iterable<T>): IterableIterator<T> {
    const transform = this._transformer
    if (typeof transform === 'undefined') return yield* itarable
    for (const value of itarable) {
      if (transform.type === 'mapper') yield transform.fnc(value)
      if (transform.type === 'filter' && transform.fnc(value)) yield value
    }
  }

  *values(): IterableIterator<T> {
    if (this._prevIter instanceof RecordsSet) yield* this.applyTransform(this._prevIter)
    yield* this.applyTransform(super.values())
  }
}