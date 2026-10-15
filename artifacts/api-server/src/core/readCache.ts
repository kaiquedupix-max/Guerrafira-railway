import { adminServer } from "./adminServerContext.js";
type Entry<T> = { value?: T; at: number; pending?: Promise<T> };
const entries = new Map<string, Entry<any>>();
export async function cachedRead<T>(key: string, read: () => Promise<T>, ttl = 5000, staleFor = 30000): Promise<T> {
  const id = `${adminServer()}:${key}`;
  let entry = entries.get(id);
  if (!entry) { entry = { at: 0 }; entries.set(id, entry); }
  if (entry.value !== undefined && Date.now() - entry.at < ttl) return entry.value;
  if (!entry.pending) entry.pending = read().then(value => {
    entry!.value = value; entry!.at = Date.now(); return value;
  }).catch(error => {
    if (entry!.value !== undefined && Date.now() - entry!.at <= staleFor) return entry!.value;
    throw error;
  }).finally(() => { entry!.pending = undefined; });
  return entry.pending;
}
export function clearReadCache(): void { entries.clear(); }
