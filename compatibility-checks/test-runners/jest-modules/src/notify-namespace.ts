// Code under test with a namespace import (TypeScript: __importStar; Babel: _interopRequireWildcard).
import * as mailer from './mailer'

export const notifyThroughNamespace = (to: string): string => mailer.send(to)
