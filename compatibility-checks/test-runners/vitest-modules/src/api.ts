// The real module that the test replaces (vi.mock). Never runs in the test.
export async function fetchHistory(room: string): Promise<string[]> {
  throw new Error(`real request for ${room}`)
}

export async function post(room: string, message: string): Promise<void> {
  throw new Error(`real post to ${room}: ${message}`)
}

export default { fetchHistory, post }
