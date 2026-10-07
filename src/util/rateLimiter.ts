/** Janela deslizante em memória: no máximo `max` eventos por chave a cada `windowMs`. */
export class SlidingWindowLimiter {
  private events = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.events.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.events.set(key, list);
    else this.events.delete(key);
    return list;
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  /** Registra um evento e retorna quantos ainda restam na janela. */
  hit(key: string): number {
    const list = this.recent(key);
    list.push(this.now());
    this.events.set(key, list);
    return Math.max(0, this.max - list.length);
  }

  /** Milissegundos até liberar uma tentativa. */
  retryAfterMs(key: string): number {
    const list = this.recent(key);
    if (list.length < this.max) return 0;
    return list[list.length - this.max]! + this.windowMs - this.now();
  }

  reset(key: string) {
    this.events.delete(key);
  }
}
