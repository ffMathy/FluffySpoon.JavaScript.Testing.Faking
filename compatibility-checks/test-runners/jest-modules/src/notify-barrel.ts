// Code under test that imports the mailer through a barrel (`export * from './mailer'`), with a named import and with a
// namespace import.
import { send } from './barrel'
import * as all from './barrel'

export const notifyThroughBarrel = (to: string): string => send(to)
export const verifyThroughBarrelNamespace = (address: string): boolean => all.verify(address)
