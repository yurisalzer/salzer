# Layouts oficiais verificados

Verificação feita registro a registro nos arquivos reais enviados (jan/2026). Se a fonte mudar o layout,
o importador **recusa** o arquivo com mensagem clara; cria-se então um novo adaptador
(`src/importacao/adaptadores/`) sem alterar o restante. Amostras reduzidas (registros copiados byte a byte
dos oficiais) ficam em `tests/fixtures/` e são regeneradas com `scripts/fixtures/reduzir_*.py`.

## EMOP-RJ — adaptador `emop-dbf-v1`

Pacote: `EMOP_MMAAAA.rar` com DBF, cópias `.xls` (que **são DBF**: mesmo conteúdo/SHA-256), XLSX auxiliares,
PDFs e DOCX. Identificação pelos **campos** do DBF (nomes e tipos exatos), nunca pela extensão.

| Arquivo | Campos (tipo/tamanho) | Registros jan/2026 |
|---|---|---:|
| EMOPmmaa | CODIGO C13, PRECO N17.2 | 22.270 |
| DIPRmmaa | CODIGO C13, DESCR1..DESCR6 C60, UNID C6, CUSTO N18.2 | 22.270 |
| COMPmmaa | CODIGO C13, SEQUENCIA C3, ELEMENTAR C5, QUANTIDADE N19.8, PERCENTUAL N19.8 | 103.386 |
| MATmmaa | ELEMENTAR C5, DESCRICAO C40, DESCR1..DESCR3 C40, UNID C6, PRECO N21.4 | 5.282 |
| REUTmmaa | ELEMENTAR C5, COMPOSICAO C10, DESCRICAO C40, DESCR1..DESCR3 C40, UNIDADE C6 | 1.962 |
| ELEMmmaa | ELEMENTAR C5, PRECO N21.4 | 7.244 |

- DBF versão 0x03, byte de idioma 0; texto em **CP850** (0xF8 = °, 0xA7 = º, 0xA6 = ª, 0x80 = Ç).
- Alguns arquivos terminam com 0x1A, outros não.
- Descrição = concatenação **sem aparar** de DESCR1..DESCRn (as palavras são cortadas entre campos:
  "…ESTR" + "UTURADA…"), aparando só o fim.
- Regime pelo dígito final do código (Catálogo de Referência 13ª ed.): 0–4 sem desoneração, A–E com
  desoneração; 1/B = composição reutilizada; 2,3,4/C,D,E = categoria 19 (equipamentos).
- `ELEM` = `MAT` ∪ `REUT` (sem sobreposição) e `MAT.PRECO` = `ELEM.PRECO` em 100%.
- `REUT.COMPOSICAO` = código do serviço sem pontuação (`0100100751` → `01.001.0075-1`), 100% resolvidos.
  Elementares de REUT têm o regime da composição vinculada; os de MAT valem para os dois regimes.
- `EMOP.PRECO` = `DIPR.CUSTO` em 22.270/22.270.
- 10 códigos `xx.xxx.9999-x` (índices) não têm componentes no COMP.
- Competência pelo nome: `COMP0126` = jan/2026 (MMAA); conferida com a escolhida no assistente.

## SINAPI — adaptador `sinapi-xlsx-2025`

Pacote: `SINAPI-AAAA-MM-formato-xlsx[_RetificacaoNN].zip` com:

| Planilha | Uso |
|---|---|
| `SINAPI_Referência_AAAA_MM.xlsx` | **obrigatória**: abas ISD/ICD/ISE (insumos), CSD/CCD/CSE (composições), Analítico |
| `SINAPI_mao_de_obra_AAAA_MM.xlsx` | opcional: % de mão de obra por composição (abas "SEM/COM Desoneração") |
| `SINAPI_Manutenções_AAAA_MM.xlsx` | opcional: histórico de manutenções (guardadas só as da competência) |
| `SINAPI_familias_e_coeficientes_AAAA_MM.xlsx` | registrada (SHA-256), não usada nos cálculos |

- Abas: `ISD`/`CSD` = sem desoneração, `ICD`/`CCD` = com desoneração, `ISE`/`CSE` = sem encargos sociais.
  O regime é confirmado pelo título da aba (linha 2).
- Linha 3: "Mês de Referência: MM/AAAA"; linha 4: "Data de emissão: DD/MM/AAAA" (Retificação 01: 23/03/2026).
- Cabeçalho na linha 10 (localizado por rótulo): insumos `Classificação | Código do Insumo | Descrição do
  Insumo | Unidade | Origem de Preço | AC … TO`; composições `Grupo | Código da Composição | Descrição |
  Unidade | (Custo (R$), %AS) × 27 UF` com as siglas das UF nas linhas 4 e 9 (RJ = coluna AO/AP).
- **Código de composição só dentro da fórmula** `HYPERLINK("#"&…,104658)`; o valor em cache é 0 porque o
  arquivo pede recálculo ao abrir (`fullCalcOnLoad`). O adaptador lê o texto da fórmula.
- Números gravados como texto decimal exato no XML (`253.45`), lidos sem ponto flutuante.
- Insumo com preço em branco na UF = sem coleta mínima → `AUSENTE` (1.351 insumos em RJ).
- Composição com custo 0 (exibido como "-") = algum item sem preço → `SEM_CUSTO`.
- Analítico: cabeçalho `Grupo | Código da Composição | Tipo Item | Código do Item | Descrição | Unidade |
  Coeficiente | Situação`; a linha da composição (sem "Tipo Item") vem antes dos seus itens
  (`COMPOSICAO`/`INSUMO`). 10.255 composições e 54.678 itens em jan/2026.
- Insumos "SEM PREÇO" existem só no Analítico (2.384 ocorrências): cadastrados como `SEM_PRECO`.
