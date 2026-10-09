# Regras de cálculo

Todos os cálculos usam aritmética decimal exata (`decimal.js`, 60 dígitos) e o banco guarda `NUMERIC`.
Nenhum valor monetário passa por ponto flutuante (exceto ao gravar células numéricas no Excel, que por
definição usa ponto flutuante; os valores já estão ajustados em 2 casas).

## Orçamento

| Grandeza | Regra |
|---|---|
| Custo unitário | O publicado pela fonte na base/regime do item (instantâneo gravado no item). Serviço próprio: informado. Composição própria: regra abaixo. |
| Preço unitário | `ajuste(custo unitário × (1 + BDI/100); 2 casas)` |
| Total do item | `ajuste(quantidade × preço unitário; 2 casas)` |
| Custo total do item | `ajuste(quantidade × custo unitário; 2 casas)` |
| Totais de etapa e geral | soma dos totais dos itens (sem novo ajuste) |
| BDI do orçamento | total geral − custo direto |

`ajuste` = **TRUNCAR** (padrão; mesma prática da EMOP e da Caixa/SINAPI) ou **ARREDONDAR** (meio para cima),
configurável por revisão. Exemplo verificado em teste (custo 208,83, BDI 25%, quantidade 3,5):

- truncar: P.U. = 208,83 × 1,25 = 261,0375 → **261,03**; total = 3,5 × 261,03 = 913,605 → **913,60**
- arredondar: P.U. → **261,04**; total = 3,5 × 261,04 = **913,64**

## BDI

`BDI = (1 + AC + S + R + G) × (1 + DF) × (1 + L) / (1 − T) − 1` — Acórdão TCU 2622/2013, adotado pela EMOP
(Catálogo de Referência 13ª ed., item 2.3). Os 36 perfis da EMOP (6 tipos de obra × 3 faixas × 2 regimes)
foram transcritos e conferidos: a fórmula reproduz todos os percentuais publicados (ex.: edifícios acima de
R$ 1,5 mi sem desoneração = 17,68% → publicado 18%; com desoneração, CPRB 2,7% → 21,18% → 21%).
O orçamento usa o **percentual adotado** (o publicado, ou o calculado com 2 casas para perfis próprios),
copiado e congelado na revisão.

## Composições — conferência na importação (o preço publicado é sempre o usado)

| Fonte | Regra reconstituída | Verificação em jan/2026 |
|---|---|---|
| EMOP | Σ TRUNC(QUANTIDADE × preço do elementar × (1 + PERCENTUAL/100); 4), truncado em 2 casas | 22.258 idênticas, 1 com R$ 0,01 de diferença |
| SINAPI | Σ TRUNC(coeficiente × custo unitário; 2) (fórmula da aba "Analítico com Custo") | 19.014 de 19.014 idênticas (3 regimes) |
| Própria | Σ TRUNC(coeficiente × custo unitário; 2) | — |

## Curva ABC
Ordena por valor decrescente; classe A até 80% acumulado, B até 95%, C o restante (o primeiro item é sempre A).
A ABC de insumos explode as composições até os insumos (coeficientes acumulados; perdas EMOP incluídas) e
mostra a diferença para o custo direto, causada pelos truncamentos por linha das próprias fontes.

## Preços ausentes
Nunca são tratados como zero: `AUSENTE` (SINAPI sem coleta na UF), `SEM_CUSTO` (composição com item sem preço,
exibida como "-" na planilha), `SEM_PRECO` (insumo que só aparece no analítico). Itens assim impedem o
fechamento da revisão. Preço **informado como zero** é aceito com aviso.
