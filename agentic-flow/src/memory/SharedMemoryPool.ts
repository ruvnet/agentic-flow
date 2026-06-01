export class SharedMemoryPool {
  private static instance: SharedMemoryPool;

  static getInstance(): SharedMemoryPool {
    if (!SharedMemoryPool.instance) {
      SharedMemoryPool.instance = new SharedMemoryPool();
    }
    return SharedMemoryPool.instance;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDatabase(): any { return null; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getEmbedder(): any { return null; }
  getStats(): Record<string, unknown> { return {}; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCachedQuery(_key: string): any { return null; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cacheQuery(_key: string, _value: any, _ttl: number): void {}
}
