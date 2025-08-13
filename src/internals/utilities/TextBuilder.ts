export class TextPart {
  private _modifiers: string[] = []
  private readonly _value: string
  constructor(valueOrInstance: string | TextPart) {
    if (valueOrInstance instanceof TextPart) {
      this._modifiers = [...valueOrInstance._modifiers]
      this._value = valueOrInstance._value
    } else this._value = valueOrInstance
  }

  private baseTextModifier(modifier: number) {
    return `\x1b[${modifier}m`
  }

  public bold() {
    this._modifiers.push(this.baseTextModifier(1))
    return this
  }

  public faint() {
    this._modifiers.push(this.baseTextModifier(2))
    return this
  }

  public italic() {
    this._modifiers.push(this.baseTextModifier(3))
    return this
  }

  public underline() {
    this._modifiers.push(this.baseTextModifier(4))
    return this
  }

  public resetFormat(): void {
    this._modifiers = []
  }

  public clone(): TextPart {
    return new TextPart(this)
  }

  toString() {
    return this._modifiers.length > 0 ? `${this._modifiers.join('')}${this._value}\x1b[0m` : this._value
  }
}

export class TextBuilder {
  private readonly _parts: TextPart[] = []

  public add(text: string, texPartCb: (textPart: TextPart) => void = () => { }): this {
    const textPart = new TextPart(text)
    this._parts.push(textPart)
    texPartCb(textPart)
    return this
  }

  public addParts(...textParts: TextPart[]): this {
    this._parts.push(...textParts)
    return this
  }

  public newLine() {
    this._parts.push(new TextPart('\n'))
    return this
  }

  public toString() {
    return this._parts.join('')
  }

  public clone() {
    return new TextBuilder().addParts(...this._parts.map(x => x.clone()))
  }

  public get parts() {
    return this._parts
  }
}