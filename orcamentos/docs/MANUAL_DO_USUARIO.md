# Manual do usuário

## Papéis

| Papel | Pode |
|---|---|
| Administrador | tudo, inclusive usuários e auditoria |
| Gestor de bases | importar, publicar/rejeitar bases EMOP e SINAPI, consultar |
| Orçamentista | criar e editar obras, orçamentos, composições próprias e perfis de BDI; fechar revisões |
| Consulta | somente leitura e exportação de relatórios |

## Importar uma base (Gestor de bases)

1. **Bases e importação → Importar nova base**.
2. Passo 1: fonte (EMOP-RJ ou SINAPI). Passo 2: competência (mês/ano). Passo 3: regimes e identificação
   (Original, Retificação 01…). Passo 4: arquivos — pode enviar o RAR/ZIP oficial inteiro.
3. O sistema identifica os arquivos pelo conteúdo (não pela extensão), confere a competência, valida e mostra:
   - **Erros**: impedem a gravação (ex.: arquivo faltando, competência diferente da escolhida).
   - **Avisos**: merecem leitura (ex.: preço zerado, insumo sem unidade).
   - **Conferência das composições**: o custo de cada composição é recalculado pela regra da própria fonte e
     comparado com o publicado. Em jan/2026: SINAPI 100% idêntico; EMOP 22.258 de 22.259 idênticos e 1
     com diferença de R$ 0,01 (arredondamento da EMOP). **O valor publicado é sempre o usado.**
4. **Pré-visualização**: confira preços, itens e composições como lidos dos arquivos.
5. **Confirmar e gravar** (uma única transação: ou grava tudo ou nada) → **Publicar**.
6. O mesmo arquivo não pode ser importado duas vezes (controle por SHA-256), salvo com permissão
   específica e justificativa, registrada na auditoria.

## Consultar EMOP / SINAPI

- Pesquise por código (`01.001.0001`, `010010001`, `104658`) ou por palavras, sem acento, em qualquer ordem
  (`piso podotatil`).
- Escolha a base (competência/retificação) e o regime. Na EMOP, códigos terminados em 0–4 são **sem
  desoneração** e em A–E **com desoneração**.
- No detalhe: preço, situação ("sem preço no mês", "sem custo"), composição analítica publicada, histórico de
  preços com gráfico e onde o insumo é usado.
- Se a fonte não publicou composição para um item, nada é exibido — **o sistema nunca inventa composição**.

## Composições próprias

- **Composições próprias → Nova composição**: componentes de qualquer base (EMOP/SINAPI/próprias) ou insumos
  de cotação (descrição, unidade e custo informados).
- Cada gravação cria uma **nova versão**; versões antigas não mudam.
- Referências circulares (A usa B que usa A) são bloqueadas.
- Na consulta de uma composição oficial, "Copiar como composição própria" cria uma cópia editável,
  sempre identificada como PRÓPRIA.

## Orçamentos

1. **Obras e orçamentos → Nova obra** → **Novo orçamento**: escolha as bases (EMOP e/ou SINAPI), o regime de
   cada uma, o BDI padrão (perfil oficial da EMOP ou percentual), o critério de valores (truncar — padrão das
   fontes — ou arredondar) e o prazo em meses.
2. Crie as etapas e subetapas (numeração 1, 1.1, 1.1.1 automática).
3. Em cada etapa, "+ adicionar item": busque o serviço, informe a quantidade. Também é possível incluir
   composição própria ou serviço próprio de cotação.
4. Quantidade: edite na própria linha e tecle Enter. BDI individual: escolha no seletor da linha
   (crie antes um "BDI diferenciado", ex.: fornecimento de equipamentos).
5. Cronograma: informe o % de cada etapa por mês (soma 100%).
6. **Fechar revisão**: congela todos os valores (inclusive a explosão até os insumos) e gera um código de
   integridade. Revisões fechadas não podem ser alteradas — nem pelo sistema, nem diretamente no banco.
7. **Nova revisão**: copia a revisão atual; se escolher outra competência/retificação, os preços são
   atualizados na nova revisão e a anterior fica intacta. Itens que não existem na nova base ficam
   sinalizados.
8. **Comparar** revisões e **Duplicar** orçamento estão na página do orçamento e da revisão.
9. Se duas pessoas editarem a mesma revisão ao mesmo tempo, a segunda recebe o aviso "alterado por outra
   pessoa — recarregue a página", sem perder o que a primeira gravou.

## Relatórios

Na revisão, "Relatórios": orçamento sintético, analítico, composições de custos unitários, curva ABC de
serviços, curva ABC de insumos, demonstrativo de BDI, cronograma físico-financeiro, memória de cálculo e
histórico de preços; o comparativo fica na tela de comparação. Todos em PDF e Excel, com obra, versão,
fontes, competência, regime e data de emissão.
