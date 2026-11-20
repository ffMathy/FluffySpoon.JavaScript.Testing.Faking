// Code under test (a native ES module) with a named import of the mocked module.
import { query } from './db.mjs'

export const count = async () => (await query('select count(*)'))[0]
