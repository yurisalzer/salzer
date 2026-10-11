import { codificacaoPorIdioma, lerCabecalhoDbf, lerRegistrosDbf, temCaracteresDeControle, type CabecalhoDbf } from "../dbf";
import { decimalDeTextoOficial } from "@/dominio/decimal";
import { codigoEmopComPontuacao, criarCompetencia, mesmaCompetencia, regimeEmopPorCodigo, type CodigoRegime } from "@/dominio/referencias";
import type { Adaptador, ArquivoEntrada, ArquivoReconhecido, ContextoImportacao, Destino, Identificacao } from "../tipos";

/**
 * Adaptador EMOP-RJ — arquivos DBF do boletim mensal (layout verificado em janeiro/2026).
 * Documentação do layout: docs/LAYOUTS_OFICIAIS.md, seção EMOP.
 */
export const LAYOUT_EMOP = "emop-dbf-v1";

type Papel = "EMOP_PRECOS_SERVICOS" | "EMOP_DESCRICOES_SERVICOS" | "EMOP_COMPOSICOES" | "EMOP_MATERIAIS" | "EMOP_REUTILIZADOS" | "EMOP_ELEMENTARES";

const D6 = ["DESCR1", "DESCR2", "DESCR3", "DESCR4", "DESCR5", "DESCR6"];
const D3 = ["DESCR1", "DESCR2", "DESCR3"];

/** Campos exigidos (nome → tipo DBF) e prefixo do nome do arquivo de cada papel. */
const LAYOUTS: Record<Papel, { prefixo: string; campos: Record<string, string>; descricao: string }> = {
  EMOP_PRECOS_SERVICOS: { prefixo: "EMOP", campos: { CODIGO: "C", PRECO: "N" }, descricao: "Preços dos serviços (EMOPmmaa)" },
  EMOP_DESCRICOES_SERVICOS: {
    prefixo: "DIPR",
    campos: { CODIGO: "C", ...Object.fromEntries(D6.map((d) => [d, "C"])), UNID: "C", CUSTO: "N" },
    descricao: "Descrições e custos dos serviços (DIPRmmaa)",
  },
  EMOP_COMPOSICOES: {
    prefixo: "COMP",
    campos: { CODIGO: "C", SEQUENCIA: "C", ELEMENTAR: "C", QUANTIDADE: "N", PERCENTUAL: "N" },
    descricao: "Composições analíticas (COMPmmaa)",
  },
  EMOP_MATERIAIS: {
    prefixo: "MAT",
    campos: { ELEMENTAR: "C", DESCRICAO: "C", ...Object.fromEntries(D3.map((d) => [d, "C"])), UNID: "C", PRECO: "N" },
    descricao: "Insumos (MATmmaa)",
  },
  EMOP_REUTILIZADOS: {
    prefixo: "REUT",
    campos: { ELEMENTAR: "C", COMPOSICAO: "C", DESCRICAO: "C", ...Object.fromEntries(D3.map((d) => [d, "C"])), UNIDADE: "C" },
    descricao: "Composições reutilizadas como elementares (REUTmmaa)",
  },
  EMOP_ELEMENTARES: { prefixo: "ELEM", campos: { ELEMENTAR: "C", PRECO: "N" }, descricao: "Preços dos elementares (ELEMmmaa)" },
};

export const PAPEIS_EMOP = Object.keys(LAYOUTS) as Papel[];

function papelPorCampos(cab: CabecalhoDbf): Papel | null {
  const campos = new Map(cab.campos.map((c) => [c.nome, c.tipo]));
  for (const [papel, l] of Object.entries(LAYOUTS) as Array<[Papel, (typeof LAYOUTS)[Papel]]>) {
    const exigidos = Object.entries(l.campos);
    if (exigidos.length !== campos.size) continue;
    if (exigidos.every(([n, t]) => campos.get(n) === t)) return papel;
  }
  return null;
}

/** "COMP0126.dbf" → { prefixo: "COMP", competencia: jan/2026 } */
export function competenciaPeloNome(nome: string): { prefixo: string; competencia: Date } | null {
  const m = /^(EMOP|DIPR|COMP|MAT|ELEM|REUT)(\d{2})(\d{2})\b/i.exec(nome);
  if (!m) return null;
  const c = criarCompetencia(2000 + Number(m[3]), Number(m[2]));
  return c ? { prefixo: m[1]!.toUpperCase(), competencia: c } : null;
}

/** Descrição longa: concatena os campos SEM aparar (as palavras são cortadas entre campos). */
export function montarDescricao(partes: Array<string | undefined>): string {
  return partes.map((p) => p ?? "").join("").trim();
}

const REGIMES_EMOP: CodigoRegime[] = ["SEM_DESONERACAO", "COM_DESONERACAO"];

export const adaptadorEmopDbfV1: Adaptador = {
  id: LAYOUT_EMOP,
  fonte: "EMOP",
  descricao: "EMOP-RJ — boletim mensal em DBF (EMOP, DIPR, COMP, MAT, REUT, ELEM)",

  async identificar(arquivos: ArquivoEntrada[]): Promise<Identificacao> {
    const reconhecidos: ArquivoReconhecido[] = [];
    const ignorados: Identificacao["ignorados"] = [];
    const porPapel = new Map<Papel, ArquivoEntrada>();
    let competencia: Date | undefined;
    // Entre cópias idênticas, prefere o nome oficial: extensão .dbf e sem "Copia".
    const peso = (a: ArquivoEntrada) => (a.nome.toLowerCase().endsWith(".dbf") ? 0 : 2) + (/c[oó]pia/i.test(a.nome) ? 1 : 0);
    const ordenados = [...arquivos].sort((x, y) => peso(x) - peso(y) || x.nome.localeCompare(y.nome));
    for (const a of ordenados) {
      if (a.assinatura !== "DBF") {
        ignorados.push({ arquivo: a, motivo: `Não é DBF (${a.assinatura}); não usado pelo adaptador EMOP` });
        continue;
      }
      const cab = await lerCabecalhoDbf(a.caminhoDisco);
      const papel = papelPorCampos(cab);
      if (!papel) {
        ignorados.push({ arquivo: a, motivo: `Campos não correspondem a nenhum layout EMOP conhecido: ${cab.campos.map((c) => c.nome).join(", ")}` });
        continue;
      }
      const existente = porPapel.get(papel);
      if (existente) {
        if (existente.sha256 === a.sha256) {
          ignorados.push({ arquivo: a, motivo: `Cópia idêntica de ${existente.nome} (mesmo SHA-256)` });
          continue;
        }
        throw new Error(`Há dois arquivos diferentes para o mesmo papel (${LAYOUTS[papel].descricao}): ${existente.nome} e ${a.nome}. Envie apenas uma competência por vez.`);
      }
      porPapel.set(papel, a);
      const pn = competenciaPeloNome(a.nome);
      if (pn && !competencia) competencia = pn.competencia;
      reconhecidos.push({ arquivo: a, papel, layout: LAYOUT_EMOP });
    }
    const faltando = PAPEIS_EMOP.filter((p) => !porPapel.has(p)).map((p) => LAYOUTS[p].descricao);
    return { reconhecidos, faltando, ignorados, sugestoes: { competencia, regimes: REGIMES_EMOP } };
  },

  async ler(ctx: ContextoImportacao, ident: Identificacao, destino: Destino): Promise<void> {
    const arq = (p: Papel) => ident.reconhecidos.find((r) => r.papel === p)!.arquivo;
    const codificacoes = new Set<string>();

    // Verificações gerais por arquivo: competência no nome e codificação.
    const abrir = async (papel: Papel) => {
      const a = arq(papel);
      const cab = await lerCabecalhoDbf(a.caminhoDisco);
      const pn = competenciaPeloNome(a.nome);
      if (!pn) {
        destino.verificacao({ regra: "EMOP_NOME_ARQUIVO", severidade: "AVISO", arquivo: a.nome, mensagem: `Nome fora do padrão ${LAYOUTS[papel].prefixo}mmaa: competência não conferida pelo nome.` });
      } else if (!mesmaCompetencia(pn.competencia, ctx.competencia)) {
        destino.verificacao({ regra: "COMPETENCIA_DIVERGENTE", severidade: "ERRO", arquivo: a.nome, mensagem: `O nome do arquivo indica competência ${pn.competencia.toISOString().slice(0, 7)}, diferente da selecionada.` });
      }
      // EMOP grava byte de idioma 0; a codificação CP850 foi verificada nos arquivos oficiais de jan/2026.
      const codificacao = codificacaoPorIdioma(cab.idioma) ?? "cp850";
      codificacoes.add(codificacao);
      await destino.arquivoReconhecido(a.id, papel, LAYOUT_EMOP, cab.registros);
      return { a, cab, registros: lerRegistrosDbf(a.caminhoDisco, { codificacao }) };
    };

    const checarTexto = (nomeArq: string, numero: number, valores: Record<string, string>) => {
      for (const [campo, v] of Object.entries(valores)) {
        if (temCaracteresDeControle(v)) {
          destino.verificacao({ regra: "CODIFICACAO", severidade: "ERRO", arquivo: nomeArq, linha: numero, mensagem: `Caractere de controle no campo ${campo}: codificação incorreta ou arquivo corrompido.` });
        }
      }
    };

    const numero = (nomeArq: string, linha: number, campo: string, texto: string, codigo: string): string | null => {
      try {
        const d = decimalDeTextoOficial(texto);
        return d === null ? null : d.toString();
      } catch {
        destino.verificacao({ regra: "NUMERO_INVALIDO", severidade: "ERRO", arquivo: nomeArq, linha, codigo, mensagem: `Valor não numérico em ${campo}: "${texto.trim()}"` });
        return null;
      }
    };

    let apagados = 0;

    // 1) REUT — elementares que são composições reutilizadas; o regime vem do código vinculado.
    const regimeReut = new Map<string, CodigoRegime | null>();
    {
      const { a, registros } = await abrir("EMOP_REUTILIZADOS");
      for await (const r of registros) {
        if (r.apagado) { apagados++; continue; }
        checarTexto(a.nome, r.numero, r.valores);
        const codigo = r.valores.ELEMENTAR!.trim();
        const compacto = r.valores.COMPOSICAO!.trim();
        const vinculada = codigoEmopComPontuacao(compacto);
        const regime = vinculada ? regimeEmopPorCodigo(vinculada) : null;
        if (!vinculada || !regime) {
          destino.verificacao({ regra: "EMOP_REUT_CODIGO", severidade: "ERRO", arquivo: a.nome, linha: r.numero, codigo, mensagem: `Código de composição vinculada inválido: "${compacto}"` });
        }
        regimeReut.set(codigo, regime);
        await destino.item({
          arquivo: a.nome, linha: r.numero, tipo: "INSUMO", codigo,
          descricao: montarDescricao([r.valores.DESCRICAO, r.valores.DESCR1, r.valores.DESCR2, r.valores.DESCR3]),
          unidade: r.valores.UNIDADE!.trim(), classe: "COMPOSICAO_REUTILIZADA", regime, codigoComposicaoVinculada: vinculada,
        });
      }
    }

    // 2) MAT — insumos (valem para os dois regimes).
    const precoMat = new Map<string, string | null>();
    {
      const { a, registros } = await abrir("EMOP_MATERIAIS");
      for await (const r of registros) {
        if (r.apagado) { apagados++; continue; }
        checarTexto(a.nome, r.numero, r.valores);
        const codigo = r.valores.ELEMENTAR!.trim();
        if (regimeReut.has(codigo)) {
          destino.verificacao({ regra: "EMOP_ELEMENTAR_DUPLICADO", severidade: "ERRO", arquivo: a.nome, linha: r.numero, codigo, mensagem: "Elementar presente em MAT e em REUT." });
        }
        precoMat.set(codigo, numero(a.nome, r.numero, "PRECO", r.valores.PRECO!, codigo));
        await destino.item({
          arquivo: a.nome, linha: r.numero, tipo: "INSUMO", codigo,
          descricao: montarDescricao([r.valores.DESCRICAO, r.valores.DESCR1, r.valores.DESCR2, r.valores.DESCR3]),
          unidade: r.valores.UNID!.trim(), classe: "INSUMO", regime: null,
        });
      }
    }

    // 3) ELEM — preço de todos os elementares (= MAT ∪ REUT, verificado).
    {
      const { a, registros } = await abrir("EMOP_ELEMENTARES");
      let divergentes = 0;
      const vistos = new Set<string>();
      for await (const r of registros) {
        if (r.apagado) { apagados++; continue; }
        const codigo = r.valores.ELEMENTAR!.trim();
        vistos.add(codigo);
        const texto = r.valores.PRECO!;
        const preco = numero(a.nome, r.numero, "PRECO", texto, codigo);
        const situacao = preco === null ? "AUSENTE" : "INFORMADO";
        let regimes: CodigoRegime[];
        if (regimeReut.has(codigo)) {
          const reg = regimeReut.get(codigo);
          regimes = reg ? [reg] : [];
        } else if (precoMat.has(codigo)) {
          regimes = REGIMES_EMOP;
          const pm = precoMat.get(codigo);
          if (pm !== preco) {
            divergentes++;
            destino.verificacao({ regra: "EMOP_MAT_ELEM_DIVERGENTE", severidade: "AVISO", arquivo: a.nome, linha: r.numero, codigo, mensagem: `Preço em MAT (${pm}) difere do ELEM (${preco}); usado o ELEM.` });
          }
        } else {
          destino.verificacao({ regra: "EMOP_ELEMENTAR_SEM_CADASTRO", severidade: "ERRO", arquivo: a.nome, linha: r.numero, codigo, mensagem: "Elementar com preço em ELEM mas sem cadastro em MAT nem REUT." });
          continue;
        }
        for (const regime of regimes) {
          await destino.preco({ arquivo: a.nome, linha: r.numero, regime, tipo: "INSUMO", codigo, precoTexto: texto.trim(), preco, situacao });
        }
      }
      for (const c of [...precoMat.keys(), ...regimeReut.keys()]) {
        if (!vistos.has(c)) {
          destino.verificacao({ regra: "EMOP_ELEMENTAR_SEM_PRECO", severidade: "AVISO", codigo: c, mensagem: "Elementar cadastrado sem linha de preço em ELEM: ficará como AUSENTE." });
          const regimes = regimeReut.has(c) ? [regimeReut.get(c)].filter(Boolean) as CodigoRegime[] : REGIMES_EMOP;
          for (const regime of regimes) await destino.preco({ arquivo: a.nome, linha: 0, regime, tipo: "INSUMO", codigo: c, precoTexto: null, preco: null, situacao: "AUSENTE" });
        }
      }
      destino.metadado("emop_mat_elem_divergentes", divergentes);
    }

    // 4) DIPR — descrição, unidade e custo dos serviços.
    const custoDipr = new Map<string, string | null>();
    {
      const { a, registros } = await abrir("EMOP_DESCRICOES_SERVICOS");
      for await (const r of registros) {
        if (r.apagado) { apagados++; continue; }
        checarTexto(a.nome, r.numero, r.valores);
        const codigo = r.valores.CODIGO!.trim();
        const regime = regimeEmopPorCodigo(codigo);
        if (!regime) {
          destino.verificacao({ regra: "EMOP_CODIGO_SERVICO", severidade: "ERRO", arquivo: a.nome, linha: r.numero, codigo, mensagem: "Código de serviço fora do padrão 00.000.0000-X." });
        }
        custoDipr.set(codigo, numero(a.nome, r.numero, "CUSTO", r.valores.CUSTO!, codigo));
        await destino.item({
          arquivo: a.nome, linha: r.numero, tipo: "COMPOSICAO", codigo,
          descricao: montarDescricao(D6.map((d) => r.valores[d])),
          unidade: r.valores.UNID!.trim(), classe: "SERVICO", grupo: codigo.slice(0, 6), regime,
        });
      }
    }

    // 5) EMOP — preço oficial do serviço (conferido com DIPR.CUSTO).
    {
      const { a, registros } = await abrir("EMOP_PRECOS_SERVICOS");
      const vistos = new Set<string>();
      let iguais = 0;
      for await (const r of registros) {
        if (r.apagado) { apagados++; continue; }
        const codigo = r.valores.CODIGO!.trim();
        vistos.add(codigo);
        const regime = regimeEmopPorCodigo(codigo);
        const texto = r.valores.PRECO!;
        const preco = numero(a.nome, r.numero, "PRECO", texto, codigo);
        if (!custoDipr.has(codigo)) {
          destino.verificacao({ regra: "EMOP_SERVICO_SEM_DESCRICAO", severidade: "ERRO", arquivo: a.nome, linha: r.numero, codigo, mensagem: "Serviço com preço mas sem descrição no DIPR." });
        } else if (custoDipr.get(codigo) !== preco) {
          destino.verificacao({ regra: "EMOP_PRECO_DIFERE_CUSTO", severidade: "AVISO", arquivo: a.nome, linha: r.numero, codigo, mensagem: `PRECO (EMOP) ${preco} difere do CUSTO (DIPR) ${custoDipr.get(codigo)}; usado o PRECO.` });
        } else iguais++;
        if (!regime) continue;
        await destino.preco({ arquivo: a.nome, linha: r.numero, regime, tipo: "COMPOSICAO", codigo, precoTexto: texto.trim(), preco, situacao: preco === null ? "AUSENTE" : "INFORMADO" });
      }
      for (const [codigo] of custoDipr) {
        if (!vistos.has(codigo)) {
          const regime = regimeEmopPorCodigo(codigo);
          destino.verificacao({ regra: "EMOP_SERVICO_SEM_PRECO", severidade: "AVISO", codigo, mensagem: "Serviço do DIPR sem linha no arquivo de preços: ficará como AUSENTE." });
          if (regime) await destino.preco({ arquivo: a.nome, linha: 0, regime, tipo: "COMPOSICAO", codigo, precoTexto: null, preco: null, situacao: "AUSENTE" });
        }
      }
      destino.metadado("emop_preco_igual_custo", iguais);
    }

    // 6) COMP — componentes e coeficientes, na ordem do arquivo.
    {
      const { a, registros } = await abrir("EMOP_COMPOSICOES");
      const ordem = new Map<string, number>();
      for await (const r of registros) {
        if (r.apagado) { apagados++; continue; }
        const pai = r.valores.CODIGO!.trim();
        const elementar = r.valores.ELEMENTAR!.trim();
        const n = (ordem.get(pai) ?? 0) + 1;
        ordem.set(pai, n);
        const coef = numero(a.nome, r.numero, "QUANTIDADE", r.valores.QUANTIDADE!, pai);
        if (coef === null) {
          destino.verificacao({ regra: "COEFICIENTE_AUSENTE", severidade: "ERRO", arquivo: a.nome, linha: r.numero, codigo: pai, mensagem: `Componente ${elementar} sem quantidade.` });
        }
        await destino.componente({
          arquivo: a.nome, linha: r.numero, codigoPai: pai, ordem: n, sequencia: r.valores.SEQUENCIA!.trim(), tipoItem: "INSUMO",
          codigoItem: elementar, coeficiente: coef, coeficienteTexto: r.valores.QUANTIDADE!.trim(),
          percentualPerda: numero(a.nome, r.numero, "PERCENTUAL", r.valores.PERCENTUAL!, pai),
        });
      }
    }

    if (apagados > 0) destino.verificacao({ regra: "REGISTROS_APAGADOS", severidade: "INFO", mensagem: `${apagados} registro(s) marcados como apagados no DBF foram ignorados.` });
    destino.metadado("codificacao", [...codificacoes].join(", "));
  },
};
