// T:TY-14 A class with a private member named received / didNotReceive / mimick (or returns, throws, ...) does not turn
// the substitute type into `never`. Such a class is treated like a conflicting member (D11): use the symbol forms.
import { Substitute, received, didNotReceive, returns } from '../src'

class Inbox {
  private received: string[] = []
  count(): number { return this.received.length }
}
const inbox = Substitute.for<Inbox>()
inbox.count().returns(3)
inbox[received]().count()
inbox[didNotReceive]().count()
const asInbox: Inbox = inbox

class Outbox {
  private didNotReceive = false
  private mimick = 1
  send(message: string): boolean { return !this.didNotReceive && this.mimick > 0 && message.length > 0 }
}
const outbox = Substitute.for<Outbox>()
outbox.send('hi').returns(true)
outbox[received]().send('hi')

// A value type with a private member named like a setup method uses the symbol form for it.
class Receipt {
  private returns = 0
  total(): number { return this.returns }
}
interface Till { print(): Receipt }
const till = Substitute.for<Till>()
const receipt: Receipt = Substitute.for<Receipt>()
till.print()[returns](receipt)
till.print().throws(new Error())
till.print().total()

class Protected {
  protected received = 1
  size(): number { return this.received }
}
const prot = Substitute.for<Protected>()
prot.size().returns(2)
prot[received]().size()

export { asInbox }
