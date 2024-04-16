import { Substitute, SubstituteOf } from './Substitute'
import { constants } from './utilities'
const clear = constants.CLEAR

export { Arg } from './Arguments'
export { Substitute, SubstituteOf }
export { clearReceivedCalls, didNotReceive, mimick, received, mimicks, rejects, resolves, returns, throws } from './Transformations'
export { clear as ClearType }

export default Substitute