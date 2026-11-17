// Code under test with a default and a named import from one module (TypeScript: __importStar; Babel:
// _interopRequireWildcard for the whole module).
import mailer, { verify } from './mailer'

export const verifyThroughMixedImport = (address: string): boolean => verify(address)
export const defaultOfMixedImport = mailer
