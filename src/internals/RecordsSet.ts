import { FilterFunction } from './Types'

type MapperFunction<T, R> = (item: T) => R
type Transformer<T, R> = { type: 'filter', predicate: FilterFunction<T> } | { type: 'mapper', predicate: MapperFunction<T, R> }

export class RecordsSet<T> extends Set<T> {
  private _transformer?: Transformer<any, any>
  private readonly _prevIter?: RecordsSet<T>

  constructor(value?: Iterable<T> | readonly T[]) {
    const isRecordSet = value instanceof RecordsSet
    super(isRecordSet ? undefined : value)
    if (isRecordSet) this._prevIter = value
  }

  get size(): number {
    const currentSize = super.size
    if (this._prevIter instanceof RecordsSet) return currentSize + this._prevIter.size
    return currentSize
  }

  filter(predicate: FilterFunction<T>): RecordsSet<T> {
    const newInstance = new RecordsSet<T>(this as RecordsSet<T>)
    newInstance._transformer = { type: 'filter', predicate }
    return newInstance
  }

  map<R>(predicate: MapperFunction<T, R>): RecordsSet<R> {
    const newInstance = new RecordsSet<R | T>(this)
    newInstance._transformer = { type: 'mapper', predicate }
    return newInstance as RecordsSet<R>
  }

  has(value: T): boolean {
    if (super.has(value)) return true
    return this._prevIter instanceof RecordsSet ? this._prevIter.has(value) : false
  }

  delete(value: T): boolean {
    const deleted = super.delete(value)
    if (deleted) return true
    return this._prevIter instanceof RecordsSet ? this._prevIter.delete(value) : false
  }

  clear() {
    if (this._prevIter instanceof RecordsSet) {
      this._prevIter.clear()
      Object.defineProperty(this, '_prevIter', { value: undefined })
    }
    super.clear()
  }

  *[Symbol.iterator](): IterableIterator<T> {
    yield* this.values()
  }

  *values(): IterableIterator<T> {
    if (this._prevIter instanceof RecordsSet) yield* this.applyTransform(this._prevIter)
    yield* this.applyTransform(super.values())
  }

  private * applyTransform(itarable: Iterable<T>): IterableIterator<T> {
    const transform = this._transformer
    if (typeof transform === 'undefined') return yield* itarable
    for (const value of itarable) {
      switch (transform.type) {
        case 'filter':
          if (transform.predicate(value)) yield value
          break
        case 'mapper': yield transform.predicate(value)
          break
      }
    }
  }
}
