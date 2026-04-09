export interface EntityStore<V> {
  get(key: string): V | undefined;
  set(value: V): void;
  setByKey(key: string, value: V): void;
  has(key: string): boolean;
  values(): Iterable<V>;
  getAll(): V[];
  clear(): void;
}

export function createEntityStore<V>(
  keyFn: (value: V) => string,
): EntityStore<V> {
  const map = new Map<string, V>();

  return {
    get(key: string): V | undefined {
      return map.get(key);
    },
    set(value: V): void {
      map.set(keyFn(value), value);
    },
    setByKey(key: string, value: V): void {
      map.set(key, value);
    },
    has(key: string): boolean {
      return map.has(key);
    },
    values(): Iterable<V> {
      return map.values();
    },
    getAll(): V[] {
      return Array.from(map.values());
    },
    clear(): void {
      map.clear();
    },
  };
}
