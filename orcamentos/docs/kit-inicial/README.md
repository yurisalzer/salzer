# Sistema web de orcamentos — EMOP e SINAPI RJ, a partir de janeiro de 2026

## Entregue nesta etapa

- `schema.sql`: primeira migracao PostgreSQL para fontes, publicacoes versionadas, precos, composicoes, importacoes, obras e revisoes de orcamento.
- `inspecionar_bases.py`: inspecao nao destrutiva de cabecalhos de DBF e nomes de abas XLSX, sem depender de bibliotecas externas.
- `mapeamento_real.md`: campos identificados nos arquivos fornecidos e regras para os adaptadores.

## Rodar

1. Crie um banco PostgreSQL no Neon e configure sua URL de conexao **somente no backend**.
2. Execute `psql "$DATABASE_URL" -f schema.sql` num ambiente seguro. Nunca compartilhe `DATABASE_URL` ou inclua a senha em codigo ou no navegador.
3. Extraia os arquivos RAR/ZIP localmente. Execute `python inspecionar_bases.py DIRETORIO_EXTRAIDO`.
4. Passe estes arquivos ao Claude Code juntamente com as amostras originais. Implemente os importadores transacionais e os testes antes de popular o banco de producao.

## Importante

**Isto e um kit inicial de modelagem e inspecao, nao um aplicativo web pronto, nem um importador completo de precos.** Ainda e preciso validar os arquivos, construir os adaptadores, identificar a abrangencia da retificacao do SINAPI, implementar autenticacao e realizar testes de calculos.

**Regras de importacao:** preservar original e hash, distinguir regimes, gravar conteudos em staging, validar numeros e codigo/unidade, nao inferir preco ausente=zero, usar publicacao/retificacao distintas; publicar somente apos verificacoes, manter snapshot dos itens do orcamento e nunca sobrescrever competencia encerrada.

**Ponto pendente de modelagem:** validar se `componentes_publicados` necessita chave por linha para sequencias repetidas e preservar todos os registros da mesma composicao; expandir para politicas de arredondamento, composicoes proprias versionadas, BDI por parcelas, autenticacao, auditoria e backups externos antes da producao.
