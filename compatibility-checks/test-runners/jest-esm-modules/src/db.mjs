// The real module that the test replaces (jest.unstable_mockModule). Never runs in the test.
export async function query(sql) {
  throw new Error(`real query: ${sql}`)
}

export default { query }
