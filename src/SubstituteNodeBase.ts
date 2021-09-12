import { SubstituteBase } from './SubstituteBase'
import { Substitute } from './Substitute'

export abstract class SubstituteNodeBase<T extends SubstituteNodeBase = SubstituteNodeBase<any>> extends SubstituteBase {
  private _parent?: T = undefined
  private _child?: T
  private _head: T & { parent: undefined }
  private _root: Substitute

  constructor(private _key: PropertyKey, caller: T | SubstituteBase) {
    super()

    if (caller instanceof Substitute) {
      caller.recorder.addIndexedRecord(this)
      this._root = caller
    }

    if (caller instanceof SubstituteNodeBase) {
      this._parent = caller
      this._head = caller.head as T & { parent: undefined }
      caller.child = this
    }

    this.root.recorder.addRecord(this)
  }

  get key(): PropertyKey {
    return this._key
  }

  set parent(parent: T | undefined) {
    this._parent = parent
  }

  get parent(): T | undefined {
    return this._parent
  }

  set child(child: T) {
    this._child = child
  }

  get child(): T {
    return this._child
  }

  get head(): T & { parent: undefined } {
    return this.isHead() ? this : this._head
  }

  protected get root(): Substitute {
    return this.head._root
  }

  protected isHead(): this is T & { parent: undefined } {
    return typeof this._parent === 'undefined'
  }

  protected isIntermediateNode(): this is T & { parent: T } {
    return !this.isHead()
  }

  protected getAllSiblings(): T[] {
    return this.root.recorder.getSiblingsOf(this) as T[]
  }

  protected getAllSiblingsOfHead(): T[] {
    return this.root.recorder.getSiblingsOf(this.head) as T[]
  }

  public abstract read(): void
  public abstract write(value: any): void
}