import { inspect, InspectOptions } from 'util'
import { SubstituteNodeBase } from './SubstituteNodeBase'
import { RecordsSet } from './RecordsSet'

export class Recorder {
  private _records: RecordsSet<SubstituteNodeBase>
  private _indexedRecords: Map<PropertyKey, RecordsSet<SubstituteNodeBase>>

  constructor() {
    this._records = new RecordsSet()
    this._indexedRecords = new Map()
  }

  public get records(): RecordsSet<SubstituteNodeBase> {
    return this._records
  }

  public get indexedRecords(): Map<PropertyKey, RecordsSet<SubstituteNodeBase>> {
    return this._indexedRecords
  }

  public addIndexedRecord(node: SubstituteNodeBase): void {
    this.addRecord(node)
    const existingNodes = this.indexedRecords.get(node.key)
    if (typeof existingNodes === 'undefined') this._indexedRecords.set(node.key, new RecordsSet([node]))
    else existingNodes.add(node)
  }

  public addRecord(node: SubstituteNodeBase): void {
    this._records.add(node)
  }

  public getSiblingsOf(node: SubstituteNodeBase): RecordsSet<SubstituteNodeBase> {
    const siblingNodes = this.indexedRecords.get(node.key) ?? new RecordsSet()
    return siblingNodes.filter(siblingNode => siblingNode !== node)
  }

  public [inspect.custom](_: number, options: InspectOptions): string {
    const entries = [...this.indexedRecords.entries()]
    return entries.map(
      ([key, value]) => `\n  ${key.toString()}: {\n${[...value.map(v => `    ${inspect(v, options)}`)].join(',\n')}\n  }`
    ).join()
  }
}