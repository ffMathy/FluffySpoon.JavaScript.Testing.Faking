// Code under test with a named import (no interop helper in TypeScript or Babel).
import { send } from './mailer'

export const notifyThroughNamedImport = (to: string): string => send(to)
