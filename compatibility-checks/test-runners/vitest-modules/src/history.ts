// Code under test with a named import and a namespace import of the mocked module.
import { fetchHistory } from './api'
import * as api from './api'

export const loadHistory = async (room: string): Promise<string[]> => (await fetchHistory(room)).map(line => line.toUpperCase())
export const shout = (room: string, message: string): Promise<void> => api.post(room, message.toUpperCase())
