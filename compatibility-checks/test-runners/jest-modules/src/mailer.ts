// The real module that the tests replace with a substitute (jest.mock). Never runs in the tests.
export function send(to: string): string {
  return `real mail to ${to}`
}

export function verify(address: string): boolean {
  return address.includes('@')
}

const mailer = { send, verify }
export default mailer
