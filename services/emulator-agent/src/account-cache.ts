export class VersionedAccountCache<T> {
  private readonly values = new Map<string, T>();
  private readonly generations = new Map<string, number>();

  capture(key: string): number {
    return this.generations.get(key) || 0;
  }

  get(key: string): T | undefined {
    return this.values.get(key);
  }

  setIfCurrent(key: string, generation: number, value: T): boolean {
    if (this.capture(key) !== generation) return false;
    this.values.set(key, value);
    return true;
  }

  invalidate(key: string): void {
    this.generations.set(key, this.capture(key) + 1);
    this.values.delete(key);
  }
}
