# Mapeamento inicial de janeiro de 2026 — observado nos arquivos enviados

## EMOP 012026.rar

| Arquivo | Registros | Campos observados |
|---|---:|---|
| EMOP0126.dbf | 22.270 | CODIGO, PRECO |
| DIPR0126.dbf | 22.270 | CODIGO, DESCR1 a DESCR6, UNID, CUSTO |
| COMP0126.dbf | 103.386 | CODIGO, SEQUENCIA, ELEMENTAR, QUANTIDADE, PERCENTUAL |
| MAT0126.dbf | 5.282 | ELEMENTAR, DESCRICAO, DESCR1 a DESCR3, UNID, PRECO |
| ELEM0126.dbf | 7.244 | ELEMENTAR, PRECO |
| REUT0126.dbf | 1.962 | ELEMENTAR, COMPOSICAO, DESCRICAO, DESCR1 a DESCR3, UNIDADE |

Leitura preliminar: EMOP0126 e DIPR0126 ligam-se por CODIGO (verificar integridade e correspondencia de PRECO/CUSTO). COMP0126 usa CODIGO de servico e ELEMENTAR de componente; MAT, ELEM e REUT usam ELEMENTAR. Verificar se componentes compostos/reutilizados requerem resolucao em varias etapas. Nao somar componentes ou deduzir preco final sem testar a regra exata de PERCENTUAL e QUANTIDADE.

Importante: os nomes de arquivo com sufixo `.xls` no RAR podem conter conteudo DBF, e **nao** devem ser interpretados automaticamente como Excel pelo sufixo. Identificar a assinatura real.

## SINAPI-2026-01-formato-xlsx_Retificacao01.zip

Arquivo principal `SINAPI_Referência_2026_01.xlsx`: abas `Menu`, `Busca`, `ISD`, `ICD`, `ISE`, `CSD`, `CCD`, `CSE`, `Analítico`, `Analítico com Custo`.

Outros arquivos: `SINAPI_familias_e_coeficientes_2026_01.xlsx`, `SINAPI_Manutenções_2026_01.xlsx`, `SINAPI_mao_de_obra_2026_01.xlsx`.

**Nao fixar coordenadas como especificacao definitiva.** Descobrir cabecalhos/linhas de dados por layout e detectar UF RJ e regime na propria planilha; tratar `Retificacao01` como revisao; manter valor ausente distinto de zero. Separar a composicao analitica do preco sintetico e detectar duplicatas com chave composta coerente.

## Etapas de desenvolvimento para Claude Code

1. Criar testes usando copias **pequenas e anonimizadas** de linhas representativas (nunca modificar os arquivos oficiais).
2. Validar extracao de DBF com codificacao correta; reconstituir descricoes longas sem perder separadores.
3. Validar as relacoes `CODIGO` e `ELEMENTAR`, inclusas referencias ausentes.
4. Mapear linhas de cabecalho e colunas do SINAPI por aba e UF/regime; conferir quantidade de linhas validas e preco de amostra.
5. Criar staging e conversao decimal rigorosa e importacao idempotente por SHA-256 + revisao da publicacao.
6. Implementar reconciliacao dos totais com a base oficial e relatorio de inconsistencias antes de publicar.
7. Testar fechamento de orcamento e snapshots imutaveis antes de construir interface completa.
