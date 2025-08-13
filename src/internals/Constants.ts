const method = Symbol('method')
const property = Symbol('property')
const propertyTypes = { method, property } as const

const get = Symbol('get')
const set = Symbol('set')
const accessorTypes = { get, set } as const

const substituteExceptionTypes = {
  callCountMismatch: 'CallCountMismatch',
  propertyNotMocked: 'PropertyNotMocked'
} as const

export const constants = {
  PROPERTY: propertyTypes,
  ACCESSOR: accessorTypes,
  EXCEPTION: substituteExceptionTypes
} as const
