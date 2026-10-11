import type { Tx } from "@/servidor/db";

export interface ParametrosGravacao {
  loteId: string;
  fonteId: string;
  uf: string;
  competencia: Date;
  regimes: string[];
  rotulo: string;
  dataEmissao: Date | null;
  /** Ponto de falha simulado — usado SOMENTE em testes de recuperação transacional. */
  falharApos?: "itens" | "precos" | "composicoes";
}

export interface ResultadoGravacao {
  revisaoBaseId: string;
  numero: number;
  contagens: Record<string, number>;
}

/**
 * Copia o staging do lote para as tabelas definitivas. DEVE ser chamada dentro de uma
 * transação: qualquer erro desfaz tudo (nenhum preço, item ou composição fica pela metade).
 */
export async function gravarRevisaoBase(tx: Tx, p: ParametrosGravacao): Promise<ResultadoGravacao> {
  const competencia = p.competencia.toISOString().slice(0, 10);
  const exec = (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params);

  // Base mensal (fonte, UF, competência) — criada se não existir e travada para numerar a revisão.
  await exec(
    `INSERT INTO bases_referencia (fonte_id, uf, competencia) VALUES ($1::uuid, $2, $3::date) ON CONFLICT DO NOTHING`,
    p.fonteId, p.uf, competencia,
  );
  const [base] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM bases_referencia WHERE fonte_id = $1::uuid AND uf = $2 AND competencia = $3::date FOR UPDATE`,
    p.fonteId, p.uf, competencia,
  );
  const [{ numero }] = (await tx.$queryRawUnsafe<Array<{ numero: number }>>(
    `SELECT coalesce(max(numero), 0)::int + 1 AS numero FROM revisoes_base WHERE base_id = $1::uuid`, base!.id,
  )) as [{ numero: number }];
  const revisao = await tx.revisoes_base.create({
    data: {
      base_id: base!.id, numero, rotulo: p.rotulo, status: "VALIDADA", regimes: p.regimes,
      data_emissao: p.dataEmissao, lote_id: p.loteId,
    },
  });
  const rev = revisao.id;

  // Só atualiza a "descrição corrente" do catálogo se esta for a competência mais recente da fonte.
  const [{ maisRecente }] = (await tx.$queryRawUnsafe<Array<{ maisRecente: boolean }>>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM revisoes_base r JOIN bases_referencia b ON b.id = r.base_id
        WHERE b.fonte_id = $1::uuid AND b.competencia > $2::date AND r.status IN ('VALIDADA', 'PUBLICADA')
     ) AS "maisRecente"`,
    p.fonteId, competencia,
  )) as [{ maisRecente: boolean }];

  // 1) Itens do lote (um por tipo+código), com a descrição da primeira ocorrência.
  await exec(`DROP TABLE IF EXISTS tmp_itens_lote`);
  await exec(
    `CREATE TEMP TABLE tmp_itens_lote ON COMMIT DROP AS
     SELECT DISTINCT ON (tipo, codigo) tipo, codigo, btrim(descricao) AS descricao, coalesce(btrim(unidade), '') AS unidade,
            max(classe) OVER w AS classe, max(grupo) OVER w AS grupo, max(regime_codigo) OVER w AS regime_codigo,
            max(codigo_composicao_vinculada) OVER w AS codigo_composicao_vinculada
       FROM stg_itens
      WHERE lote_id = $1::uuid AND descricao IS NOT NULL AND btrim(descricao) <> ''
     WINDOW w AS (PARTITION BY tipo, codigo)
      ORDER BY tipo, codigo, arquivo, linha`,
    p.loteId,
  );
  await exec(
    `INSERT INTO itens_referencia (fonte_id, tipo, codigo, descricao, unidade, classe, grupo, regime_codigo, codigo_composicao_vinculada)
     SELECT $1::uuid, tipo, codigo, descricao, unidade, classe, grupo, regime_codigo, codigo_composicao_vinculada FROM tmp_itens_lote
     ON CONFLICT (fonte_id, tipo, codigo) DO UPDATE
        SET descricao = EXCLUDED.descricao, unidade = EXCLUDED.unidade,
            classe = coalesce(EXCLUDED.classe, itens_referencia.classe), grupo = coalesce(EXCLUDED.grupo, itens_referencia.grupo),
            regime_codigo = coalesce(EXCLUDED.regime_codigo, itens_referencia.regime_codigo),
            codigo_composicao_vinculada = coalesce(EXCLUDED.codigo_composicao_vinculada, itens_referencia.codigo_composicao_vinculada),
            atualizado_em = now()
      WHERE $2::boolean`,
    p.fonteId, maisRecente,
  );
  await exec(`ALTER TABLE tmp_itens_lote ADD COLUMN item_id uuid, ADD COLUMN descricao_id uuid`);
  await exec(
    `UPDATE tmp_itens_lote t SET item_id = i.id FROM itens_referencia i
      WHERE i.fonte_id = $1::uuid AND i.tipo = t.tipo AND i.codigo = t.codigo`,
    p.fonteId,
  );
  await exec(
    `INSERT INTO descricoes_item (item_id, descricao, unidade, hash)
     SELECT item_id, descricao, unidade, md5(descricao || chr(31) || unidade) FROM tmp_itens_lote
     ON CONFLICT (item_id, hash) DO NOTHING`,
  );
  await exec(
    `UPDATE tmp_itens_lote t SET descricao_id = d.id FROM descricoes_item d
      WHERE d.item_id = t.item_id AND d.hash = md5(t.descricao || chr(31) || t.unidade)`,
  );
  await exec(`CREATE INDEX ON tmp_itens_lote (tipo, codigo)`);
  if (p.falharApos === "itens") throw new Error("Falha simulada após gravar itens");

  // 2) Preços da revisão (+ % de mão de obra quando houver).
  const precos = await exec(
    `INSERT INTO precos_referencia (revisao_base_id, regime_codigo, item_id, descricao_id, preco, situacao, origem_preco, percentual_as, percentual_mao_obra, linha_origem)
     SELECT $2::uuid, s.regime_codigo, t.item_id, t.descricao_id, s.preco, s.situacao, s.origem_preco, s.percentual_as, a.valor, s.linha
       FROM stg_precos s
       JOIN tmp_itens_lote t ON t.tipo = s.tipo AND t.codigo = s.codigo
       LEFT JOIN stg_atributos a ON a.lote_id = s.lote_id AND a.atributo = 'percentual_mao_obra'
                               AND a.regime_codigo = s.regime_codigo AND a.tipo = s.tipo AND a.codigo = s.codigo
      WHERE s.lote_id = $1::uuid AND s.regime_codigo = ANY($3::text[])`,
    p.loteId, rev, p.regimes,
  );
  // Itens que só aparecem como componentes (ex.: SINAPI "SEM PREÇO" / "EM ESTUDO"): registrados sem preço.
  const semPreco = await exec(
    `INSERT INTO precos_referencia (revisao_base_id, regime_codigo, item_id, descricao_id, preco, situacao)
     SELECT $2::uuid, r.regime, t.item_id, t.descricao_id, NULL, CASE t.tipo WHEN 'INSUMO' THEN 'SEM_PRECO' ELSE 'SEM_CUSTO' END
       FROM tmp_itens_lote t CROSS JOIN unnest($3::text[]) AS r(regime)
      WHERE NOT EXISTS (SELECT 1 FROM stg_precos s WHERE s.lote_id = $1::uuid AND s.tipo = t.tipo AND s.codigo = t.codigo)`,
    p.loteId, rev, p.regimes,
  );
  if (p.falharApos === "precos") throw new Error("Falha simulada após gravar preços");

  // 3) Composições: versão identificada pelo hash do conteúdo; reaproveita versões iguais.
  await exec(`DROP TABLE IF EXISTS tmp_comp_lote`);
  await exec(
    `CREATE TEMP TABLE tmp_comp_lote ON COMMIT DROP AS
     SELECT c.codigo_pai, md5(string_agg(
              c.ordem || '|' || c.tipo_item || '|' || c.codigo_item || '|' || c.coeficiente::text || '|' ||
              coalesce(c.percentual_perda::text, '') || '|' || coalesce(c.sequencia, ''), E'\\n' ORDER BY c.ordem)) AS hash
       FROM stg_componentes c WHERE c.lote_id = $1::uuid GROUP BY c.codigo_pai`,
    p.loteId,
  );
  await exec(`ALTER TABLE tmp_comp_lote ADD COLUMN item_id uuid, ADD COLUMN composicao_id uuid`);
  await exec(`UPDATE tmp_comp_lote c SET item_id = t.item_id FROM tmp_itens_lote t WHERE t.tipo = 'COMPOSICAO' AND t.codigo = c.codigo_pai`);
  const novas = await exec(
    `INSERT INTO composicoes (item_id, origem, hash_conteudo, versao, primeira_revisao_base_id)
     SELECT c.item_id, 'OFICIAL', c.hash,
            coalesce((SELECT max(versao) FROM composicoes x WHERE x.item_id = c.item_id), 0) + 1, $1::uuid
       FROM tmp_comp_lote c
     ON CONFLICT (item_id, hash_conteudo) DO NOTHING`,
    rev,
  );
  await exec(`UPDATE tmp_comp_lote c SET composicao_id = x.id FROM composicoes x WHERE x.item_id = c.item_id AND x.hash_conteudo = c.hash`);
  const componentes = await exec(
    `INSERT INTO composicao_itens (composicao_id, ordem, sequencia, tipo_item, item_id, codigo_original, coeficiente, percentual_perda)
     SELECT c.composicao_id, s.ordem, s.sequencia, s.tipo_item, t.item_id, s.codigo_item, s.coeficiente, s.percentual_perda
       FROM stg_componentes s
       JOIN tmp_comp_lote c ON c.codigo_pai = s.codigo_pai
       JOIN composicoes x ON x.id = c.composicao_id AND x.primeira_revisao_base_id = $2::uuid
       JOIN tmp_itens_lote t ON t.tipo = s.tipo_item AND t.codigo = s.codigo_item
      WHERE s.lote_id = $1::uuid`,
    p.loteId, rev,
  );
  const publicadas = await exec(
    `INSERT INTO composicoes_publicadas (revisao_base_id, item_id, composicao_id, situacao)
     SELECT $2::uuid, c.item_id, c.composicao_id,
            (SELECT min(sc.situacao) FROM stg_composicoes sc WHERE sc.lote_id = $1::uuid AND sc.codigo = c.codigo_pai)
       FROM tmp_comp_lote c`,
    p.loteId, rev,
  );
  if (p.falharApos === "composicoes") throw new Error("Falha simulada após gravar composições");

  const manutencoes = await exec(
    `INSERT INTO manutencoes_sinapi (revisao_base_id, referencia, tipo, codigo, descricao, manutencao)
     SELECT $2::uuid, referencia, tipo, codigo, descricao, manutencao FROM stg_manutencoes WHERE lote_id = $1::uuid ORDER BY linha`,
    p.loteId, rev,
  );

  return {
    revisaoBaseId: rev,
    numero,
    contagens: {
      precos: precos + semPreco,
      itens_sem_preco_publicado: semPreco,
      composicoes_novas_versoes: novas,
      componentes_gravados: componentes,
      composicoes_publicadas: publicadas,
      manutencoes,
    },
  };
}
