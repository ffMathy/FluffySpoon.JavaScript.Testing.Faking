import { Graph } from './Graph'

export class Node<TGraph extends Graph = Graph, TNode extends Node = Node<Graph, any>> {
  private _parent: TGraph | TNode
  private _child?: TNode
  private _head: TNode & { parent: TGraph }

  constructor() { }

  set parent(parent: TGraph | TNode) {
    this._parent = parent
  }

  get parent(): TGraph | TNode {
    return this._parent
  }

  set child(child: TNode) {
    this._child = child
  }

  get child(): TNode {
    return this._child
  }

  set head(head: TNode & { parent: TGraph }) {
    this._head = head
  }

  get head(): TNode & { parent: TGraph } {
    return (this.isHead() ? this : this._head)
  }

  protected isHead(): this is TNode & { parent: TGraph } {
    return typeof this._head === 'undefined'
  }

  protected isIntermediateNode(): this is TNode & { parent: TNode } {
    return !this.isHead()
  }
}