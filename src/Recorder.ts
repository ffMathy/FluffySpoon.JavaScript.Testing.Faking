import { inspect, InspectOptions } from 'util'
import { SubstituteNodeBase } from './SubstituteNodeBase'

export class Recorder {
  private _records: SubstituteNodeBase[]
  private _indexedRecords: Map<PropertyKey, SubstituteNodeBase[]>

  constructor() {
    this._records = []
    this._indexedRecords = new Map()
  }

  public get records(): SubstituteNodeBase[] {
    return this._records
  }

  public get indexedRecords(): Map<PropertyKey, SubstituteNodeBase[]> {
    return this._indexedRecords
  }

  public addIndexedRecord(node: SubstituteNodeBase): void {
    const existingNodes = this.indexedRecords.get(node.key)
    if (typeof existingNodes === 'undefined') this._indexedRecords.set(node.key, [node])
    else existingNodes.push(node)
  }

  public addRecord(node: SubstituteNodeBase): void {
    this._records.push(node)
  }

  public getSiblingsOf(node: SubstituteNodeBase): SubstituteNodeBase[] {
    const siblingNodes = this.indexedRecords.get(node.key) ?? []
    return siblingNodes.filter(siblingNode => siblingNode !== node)
  }

  public [inspect.custom](_: number, options: InspectOptions): string {
    const entries = [...this.indexedRecords.entries()]
    return entries.map(([key, value]) => `\n  ${key.toString()}: {\n${value.map(v => `    ${inspect(v, options)}`).join(',\n')}\n  }`).join()
  }
}