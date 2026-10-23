import type { KeyValueStore } from './ports.ts'

/** KeyValueStore fake for tests; TTLs are recorded but not enforced. */
export class MemoryKv implements KeyValueStore {
  readonly data = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }
  async put(key: string, value: string): Promise<void> {
    this.data.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }
}
