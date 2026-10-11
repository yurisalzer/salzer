/**
 * Detecção de referências circulares entre composições (A usa B, B usa A).
 * `dependencias(no)` devolve os nós usados diretamente por `no`.
 * Retorna o caminho do ciclo (ex.: ["A", "B", "A"]) ou null.
 */
export function encontrarCiclo(inicio: string, dependencias: (no: string) => Iterable<string>): string[] | null {
  const BRANCO = 0, CINZA = 1, PRETO = 2;
  const cor = new Map<string, number>();
  const pilha: string[] = [];

  const visitar = (no: string): string[] | null => {
    cor.set(no, CINZA);
    pilha.push(no);
    for (const dep of dependencias(no)) {
      const c = cor.get(dep) ?? BRANCO;
      if (c === CINZA) {
        const i = pilha.indexOf(dep);
        return [...pilha.slice(i), dep];
      }
      if (c === BRANCO) {
        const r = visitar(dep);
        if (r) return r;
      }
    }
    pilha.pop();
    cor.set(no, PRETO);
    return null;
  };
  return visitar(inicio);
}

/** Verifica um grafo inteiro (mapa nó → dependências). */
export function encontrarCicloNoGrafo(grafo: Map<string, string[]>): string[] | null {
  const verificados = new Set<string>();
  for (const no of grafo.keys()) {
    if (verificados.has(no)) continue;
    const ciclo = encontrarCiclo(no, (n) => grafo.get(n) ?? []);
    if (ciclo) return ciclo;
    verificados.add(no);
  }
  return null;
}
