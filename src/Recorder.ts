import { inspect, InspectOptions } from 'util'

import { FilterFunction } from './Types'
import { RecordsSet } from './RecordsSet'

export class Recorder<TRecord> {
  private _identity: PropertyKey
  private _records: RecordsSet<TRecord>
  private _indexedRecords: Map<PropertyKey, RecordsSet<TRecord>>

  private constructor(identity: PropertyKey) {
    this._identity = identity
    this._records = new RecordsSet()
    this._indexedRecords = new Map()
  }

  public static withIdentityProperty<TRecord>(identity: keyof TRecord): Recorder<TRecord> {
    return new this(identity)
  }

  public get records(): RecordsSet<TRecord> {
    return this._records
  }

  public get indexedRecords(): Map<PropertyKey, RecordsSet<TRecord>> {
    return this._indexedRecords
  }

  public addIndexedRecord(record: TRecord): void {
    const id = this.getIdentity(record)
    this.addRecord(record)
    const existingNodes = this.indexedRecords.get(id)
    if (typeof existingNodes === 'undefined') this.indexedRecords.set(id, new RecordsSet([record]))
    else existingNodes.add(record)
  }

  public addRecord(record: TRecord): void {
    this._records.add(record)
  }

  public getSiblingsOf(record: TRecord): RecordsSet<TRecord> {
    const siblings = this.indexedRecords.get(this.getIdentity(record)) ?? new RecordsSet()
    return siblings.filter(sibling => sibling !== record)
  }

  public clearRecords(filterFunction: FilterFunction<TRecord>) {
    const recordsToRemove = this.records.filter(filterFunction)
    for (const record of recordsToRemove) {
      const id = this.getIdentity(record)
      const indexedRecord = this.indexedRecords.get(id)
      indexedRecord.delete(record)
      if (indexedRecord.size === 0) this.indexedRecords.delete(id)
      this.records.delete(record)
    }
  }

  public [inspect.custom](_: number, options: InspectOptions): string {
    const entries = [...this.indexedRecords.entries()]
    return entries.map(
      ([key, value]) => `\n  ${key.toString()}: {\n${[...value.map(v => `    ${inspect(v, options)}`)].join(',\n')}\n  }`
    ).join()
  }

  private getIdentity(record: TRecord): PropertyKey {
    // for typescript < 4.6, we need to intersect PropertyKey with the default type
    return record[this._identity as keyof TRecord] as TRecord[keyof TRecord] & PropertyKey
  }
}