import { Node } from './Node'

export class Graph {
  private _records: Node[]
  private _indexedRecords: Map<PropertyKey, Node[]>

  constructor() {
    this._records = []
    this._indexedRecords = new Map()
  }

  protected get records(): Node[] {
    return this._records
  }

  protected get indexedRecords(): Map<PropertyKey, Node[]> {
    return this._indexedRecords
  }

  protected addNodeBranch(newNode: Node, mapKey: PropertyKey): void {
    const existingNodes = this.indexedRecords.get(mapKey) ?? []
    this._indexedRecords.set(mapKey, [...existingNodes, newNode])
    this._records.push(newNode)
  }

}