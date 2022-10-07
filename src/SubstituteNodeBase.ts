import { Recorder } from './Recorder'
import { RecordsSet } from './RecordsSet'

export abstract class SubstituteNodeBase extends Function {
  private _root: this & { parent: undefined }
  private _parent?: this
  private _child?: this
  private _depth: number

  private _recorder: Recorder<this>

  constructor(private _key: PropertyKey, parent?: SubstituteNodeBase) {
    super()
    const shouldBeRoot = !this.isNode(parent)
    if (shouldBeRoot) {
      this._recorder = Recorder.withIdentityProperty('key')
      this._root = this as this & { parent: undefined }
      this._depth = 0
      return
    }

    parent.child = this
    this._parent = parent
    this._recorder = parent.recorder
    this._root = parent.root
    this._depth = parent.depth + 1
    if (this.parent === this.root) this.recorder.addIndexedRecord(this)
  }

  private isNode(node?: SubstituteNodeBase): node is this {
    return typeof node !== 'undefined'
  }

  public get key(): PropertyKey {
    return this._key
  }

  public get recorder(): Recorder<this> {
    return this._recorder
  }

  protected get parent(): this | undefined {
    return this._parent as this
  }

  protected set child(child: this) {
    this._child = child
  }

  protected get child(): this {
    return this._child
  }

  protected get root(): this & { parent: undefined } {
    return this._root
  }

  protected get depth(): number {
    return this._depth
  }

  protected isRoot(): this is this & { parent: undefined } {
    return typeof this._parent === 'undefined'
  }

  protected isIntermediateNode(): this is this & { parent: ThisType<SubstituteNodeBase> } {
    return !this.isRoot()
  }

  protected getAllSiblings(): RecordsSet<this> {
    return this.recorder.getSiblingsOf(this)
  }

  public abstract read(): void
  public abstract write(value: any): void
}