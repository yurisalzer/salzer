import { encontrarCicloNoGrafo } from "@/dominio/ciclos";
import { D } from "@/dominio/decimal";
import type { Tx } from "@/servidor/db";
import type { SiglaFonteOficial, Verificacao } from "./tipos";

/**
 * Validações de consistência executadas em SQL sobre o staging de um lote.
 * Retorna verificações (ERRO bloqueia a confirmação; AVISO e INFO vão para o relatório).
 */
export async function validarStaging(db: Tx, loteId: string, fonte: SiglaFonteOficial): Promise<Verificacao[]> {
  const v: Verificacao[] = [];
  const q = <T>(sql: string, ...p: unknown[]) => db.$queryRawUnsafe<T[]>(sql, loteId, ...p);

  // Preço duplicado para o mesmo item/regime
  for (const r of await q<{ regime_codigo: string; tipo: string; codigo: string; n: number }>(
    `SELECT regime_codigo, tipo, codigo, count(*)::int n FROM stg_precos WHERE lote_id = $1::uuid
     GROUP BY 1, 2, 3 HAVING count(*) > 1 ORDER BY 3 LIMIT 200`)) {
    v.push({ regra: "PRECO_DUPLICADO", severidade: "ERRO", codigo: r.codigo, mensagem: `${r.tipo} ${r.codigo} aparece ${r.n} vezes no regime ${r.regime_codigo}.` });
  }

  // Item sem descrição ou unidade
  for (const r of await q<{ tipo: string; codigo: string; arquivo: string; linha: number }>(
    `SELECT tipo, codigo, min(arquivo) arquivo, min(linha) linha FROM stg_itens WHERE lote_id = $1::uuid
     GROUP BY tipo, codigo HAVING bool_and(descricao IS NULL OR btrim(descricao) = '') LIMIT 200`)) {
    v.push({ regra: "ITEM_SEM_DESCRICAO", severidade: "ERRO", codigo: r.codigo, arquivo: r.arquivo, linha: r.linha, mensagem: `${r.tipo} ${r.codigo} sem descrição.` });
  }
  for (const r of await q<{ tipo: string; codigo: string }>(
    `SELECT tipo, codigo FROM stg_itens WHERE lote_id = $1::uuid
     GROUP BY tipo, codigo HAVING bool_and(unidade IS NULL OR btrim(unidade) = '') LIMIT 200`)) {
    v.push({ regra: "ITEM_SEM_UNIDADE", severidade: "AVISO", codigo: r.codigo, mensagem: `${r.tipo} ${r.codigo} sem unidade.` });
  }

  // Mesmo código com descrições/unidades diferentes no mesmo lote
  for (const r of await q<{ tipo: string; codigo: string; n: number }>(
    `SELECT tipo, codigo, count(DISTINCT (descricao, unidade))::int n FROM stg_itens
     WHERE lote_id = $1::uuid AND descricao IS NOT NULL GROUP BY tipo, codigo HAVING count(DISTINCT (descricao, unidade)) > 1 LIMIT 200`)) {
    v.push({ regra: "ITEM_DESCRICAO_DIVERGENTE", severidade: "AVISO", codigo: r.codigo, mensagem: `${r.tipo} ${r.codigo} tem ${r.n} descrições/unidades diferentes nos arquivos; usada a da primeira ocorrência.` });
  }

  // Preço de item não cadastrado
  for (const r of await q<{ tipo: string; codigo: string; arquivo: string; linha: number }>(
    `SELECT p.tipo, p.codigo, p.arquivo, p.linha FROM stg_precos p WHERE p.lote_id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM stg_itens i WHERE i.lote_id = p.lote_id AND i.tipo = p.tipo AND i.codigo = p.codigo) LIMIT 200`)) {
    v.push({ regra: "PRECO_SEM_ITEM", severidade: "ERRO", codigo: r.codigo, arquivo: r.arquivo, linha: r.linha, mensagem: `Preço de ${r.tipo} ${r.codigo} sem cadastro do item.` });
  }

  // Componentes que apontam para itens ou composições inexistentes
  for (const r of await q<{ codigo_pai: string; codigo_item: string; tipo_item: string; arquivo: string; linha: number }>(
    `SELECT c.codigo_pai, c.codigo_item, c.tipo_item, c.arquivo, c.linha FROM stg_componentes c WHERE c.lote_id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM stg_itens i WHERE i.lote_id = c.lote_id AND i.tipo = c.tipo_item AND i.codigo = c.codigo_item) LIMIT 200`)) {
    v.push({ regra: "COMPONENTE_INEXISTENTE", severidade: "ERRO", codigo: r.codigo_pai, arquivo: r.arquivo, linha: r.linha, mensagem: `Componente ${r.tipo_item} ${r.codigo_item} não cadastrado.` });
  }
  for (const r of await q<{ codigo_pai: string }>(
    `SELECT DISTINCT c.codigo_pai FROM stg_componentes c WHERE c.lote_id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM stg_itens i WHERE i.lote_id = c.lote_id AND i.tipo = 'COMPOSICAO' AND i.codigo = c.codigo_pai) LIMIT 200`)) {
    v.push({ regra: "COMPOSICAO_INEXISTENTE", severidade: "ERRO", codigo: r.codigo_pai, mensagem: `Componentes de ${r.codigo_pai}, mas a composição não está cadastrada.` });
  }
  for (const r of await q<{ codigo_pai: string; ordem: number }>(
    `SELECT codigo_pai, ordem FROM stg_componentes WHERE lote_id = $1::uuid GROUP BY 1, 2 HAVING count(*) > 1 LIMIT 50`)) {
    v.push({ regra: "COMPONENTE_DUPLICADO", severidade: "ERRO", codigo: r.codigo_pai, mensagem: `Ordem ${r.ordem} repetida na composição ${r.codigo_pai}.` });
  }
  for (const r of await q<{ codigo_pai: string; codigo_item: string }>(
    `SELECT codigo_pai, codigo_item FROM stg_componentes WHERE lote_id = $1::uuid AND coeficiente < 0 LIMIT 50`)) {
    v.push({ regra: "COEFICIENTE_NEGATIVO", severidade: "ERRO", codigo: r.codigo_pai, mensagem: `Coeficiente negativo para ${r.codigo_item}.` });
  }

  // Preços zerados (informados como zero) e ausentes
  const zerados = await q<{ regime_codigo: string; tipo: string; codigo: string; arquivo: string; linha: number }>(
    `SELECT regime_codigo, tipo, codigo, arquivo, linha FROM stg_precos WHERE lote_id = $1::uuid AND situacao = 'INFORMADO' AND preco = 0 ORDER BY codigo LIMIT 200`);
  for (const r of zerados) {
    v.push({ regra: "PRECO_ZERADO", severidade: "AVISO", codigo: r.codigo, arquivo: r.arquivo, linha: r.linha, mensagem: `${r.tipo} ${r.codigo} com preço ZERO informado (${r.regime_codigo}). Confira no arquivo oficial.` });
  }
  for (const r of await q<{ regime_codigo: string; tipo: string; situacao: string; n: number }>(
    `SELECT regime_codigo, tipo, situacao, count(*)::int n FROM stg_precos WHERE lote_id = $1::uuid GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)) {
    v.push({ regra: "RESUMO_PRECOS", severidade: "INFO", mensagem: `${r.regime_codigo} · ${r.tipo === "INSUMO" ? "insumos" : "composições"} · ${r.situacao}: ${r.n}` });
  }

  // Composições sem componentes publicados
  const semComp = await q<{ codigo: string }>(
    `SELECT DISTINCT i.codigo FROM stg_itens i WHERE i.lote_id = $1::uuid AND i.tipo = 'COMPOSICAO'
       AND NOT EXISTS (SELECT 1 FROM stg_componentes c WHERE c.lote_id = i.lote_id AND c.codigo_pai = i.codigo) ORDER BY 1 LIMIT 100`);
  if (semComp.length > 0) {
    v.push({ regra: "COMPOSICAO_SEM_COMPONENTES", severidade: "INFO", mensagem: `${semComp.length} composição(ões)/serviço(s) sem composição analítica no arquivo (ex.: ${semComp.slice(0, 5).map((r) => r.codigo).join(", ")}). Não será exibida composição para eles.`, detalhes: semComp.map((r) => r.codigo) });
  }

  // Referência circular entre composições
  const arestas = await q<{ pai: string; filho: string }>(
    fonte === "EMOP"
      ? `SELECT c.codigo_pai pai, i.codigo_composicao_vinculada filho FROM stg_componentes c
           JOIN stg_itens i ON i.lote_id = c.lote_id AND i.tipo = 'INSUMO' AND i.codigo = c.codigo_item AND i.codigo_composicao_vinculada IS NOT NULL
          WHERE c.lote_id = $1::uuid GROUP BY 1, 2`
      : `SELECT codigo_pai pai, codigo_item filho FROM stg_componentes WHERE lote_id = $1::uuid AND tipo_item = 'COMPOSICAO' GROUP BY 1, 2`);
  const grafo = new Map<string, string[]>();
  for (const a of arestas) grafo.set(a.pai, [...(grafo.get(a.pai) ?? []), a.filho]);
  const ciclo = encontrarCicloNoGrafo(grafo);
  if (ciclo) v.push({ regra: "REFERENCIA_CIRCULAR", severidade: "ERRO", codigo: ciclo[0], mensagem: `Referência circular entre composições: ${ciclo.join(" → ")}` });

  v.push(...(await reconciliar(db, loteId, fonte)));
  return v;
}

/**
 * Confere o preço publicado das composições com a regra de cálculo da própria fonte
 * (docs/PLANEJAMENTO.md §4). Serve de controle de integridade; o preço oficial é mantido.
 */
async function reconciliar(db: Tx, loteId: string, fonte: SiglaFonteOficial): Promise<Verificacao[]> {
  const sql =
    fonte === "EMOP"
      ? `WITH linhas AS (
           SELECT c.codigo_pai, s.regime_codigo,
                  trunc(c.coeficiente * e.preco * (1 + coalesce(c.percentual_perda, 0) / 100), 4) AS valor,
                  e.situacao AS sit
             FROM stg_componentes c
             JOIN stg_precos s ON s.lote_id = c.lote_id AND s.tipo = 'COMPOSICAO' AND s.codigo = c.codigo_pai
             LEFT JOIN stg_precos e ON e.lote_id = c.lote_id AND e.tipo = 'INSUMO' AND e.codigo = c.codigo_item AND e.regime_codigo = s.regime_codigo
            WHERE c.lote_id = $1::uuid)
         SELECT l.codigo_pai codigo, l.regime_codigo, trunc(sum(l.valor), 2)::text calculado, p.preco::text publicado
           FROM linhas l JOIN stg_precos p ON p.lote_id = $1::uuid AND p.tipo = 'COMPOSICAO' AND p.codigo = l.codigo_pai AND p.regime_codigo = l.regime_codigo
          WHERE p.situacao = 'INFORMADO'
          GROUP BY l.codigo_pai, l.regime_codigo, p.preco
         HAVING bool_and(l.sit = 'INFORMADO')`
      : `WITH linhas AS (
           SELECT c.codigo_pai, s.regime_codigo, trunc(c.coeficiente * f.preco, 2) AS valor, f.situacao AS sit
             FROM stg_componentes c
             JOIN stg_precos s ON s.lote_id = c.lote_id AND s.tipo = 'COMPOSICAO' AND s.codigo = c.codigo_pai
             LEFT JOIN stg_precos f ON f.lote_id = c.lote_id AND f.tipo = c.tipo_item AND f.codigo = c.codigo_item AND f.regime_codigo = s.regime_codigo
            WHERE c.lote_id = $1::uuid)
         SELECT l.codigo_pai codigo, l.regime_codigo, sum(l.valor)::text calculado, p.preco::text publicado
           FROM linhas l JOIN stg_precos p ON p.lote_id = $1::uuid AND p.tipo = 'COMPOSICAO' AND p.codigo = l.codigo_pai AND p.regime_codigo = l.regime_codigo
          WHERE p.situacao = 'INFORMADO'
          GROUP BY l.codigo_pai, l.regime_codigo, p.preco
         HAVING bool_and(l.sit = 'INFORMADO')`;
  const linhas = await db.$queryRawUnsafe<Array<{ codigo: string; regime_codigo: string; calculado: string; publicado: string }>>(sql, loteId);
  let exatas = 0;
  let umCentavo = 0;
  const divergentes: typeof linhas = [];
  for (const l of linhas) {
    const dif = D(l.calculado).minus(l.publicado).abs();
    if (dif.isZero()) exatas++;
    else if (dif.lte("0.01")) umCentavo++;
    else divergentes.push(l);
  }
  const v: Verificacao[] = [];
  const regra = fonte === "EMOP" ? "Σ TRUNC(q × p × (1+%/100); 4), truncado em 2 casas" : "Σ TRUNC(coeficiente × custo; 2)";
  v.push({
    regra: "RECONCILIACAO_COMPOSICOES",
    severidade: "INFO",
    mensagem: `Conferência de ${linhas.length} composições com todos os preços (${regra}): ${exatas} idênticas ao publicado, ${umCentavo} com diferença de R$ 0,01 (arredondamento da fonte), ${divergentes.length} com diferença maior.`,
    detalhes: { total: linhas.length, exatas, umCentavo, divergentes: divergentes.length },
  });
  for (const d of divergentes.slice(0, 100)) {
    v.push({ regra: "RECONCILIACAO_DIVERGENTE", severidade: "AVISO", codigo: d.codigo, mensagem: `${d.codigo} (${d.regime_codigo}): publicado R$ ${d.publicado}, recalculado R$ ${d.calculado}. O valor publicado é mantido.` });
  }
  return v;
}
