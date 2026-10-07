/** Exclusão mútua simples: executa as funções uma de cada vez, na ordem de chegada. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(fn, fn);
    // A fila continua mesmo se uma função falhar.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
