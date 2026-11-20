// Code under test with a default import (TypeScript: __importDefault; Babel: _interopRequireDefault).
import mailer from './mailer'

export const notifyThroughDefaultImport = (to: string): string => mailer.send(to)
export const defaultImport = mailer
