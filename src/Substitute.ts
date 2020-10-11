import { ContextNode } from './ContextNode'
import { Graph } from './linked-list/Graph'
import { ObjectSubstitute, OmitProxyMethods } from './Transformations'

export type SubstituteOf<T extends Object> = ObjectSubstitute<OmitProxyMethods<T>, T> & T

export class Substitute extends Graph {
  private _proxy: () => void

  private constructor() {
    super()
    this._proxy = new Proxy(() => { }, {
      getPrototypeOf() { // Set custom prototype -> overrideSubstitutePrototype/Instance?
        return Substitute.prototype
      },
      get: (_target, _property) => {
        const node = new ContextNode(_property)
        node.parent = this

        this.addNodeBranch(node, _property)
        return node.returnProxyOrSubstitution()
      }
    })
  }

  static for<T>(): SubstituteOf<T> {
    const substitute = new this()
    return substitute.proxy as unknown as SubstituteOf<T>
  }

  get proxy() {
    return this._proxy
  }

  public getSiblingsOf(node: ContextNode): ContextNode[] {
    const siblingNodes = this.indexedRecords.get(node.property) as ContextNode[]
    return siblingNodes.filter(siblingNode => siblingNode != node)
  }
}