# Sistema de Orçamento de Obras — EMOP-RJ e SINAPI

Aplicação web para orçamentos de obras públicas e privadas no Rio de Janeiro, com bases oficiais
**EMOP-RJ** e **SINAPI** (a partir de janeiro/2026).

| Documento | Conteúdo |
|---|---|
| [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) | **Comece aqui**: colocar no ar (Neon + Render), backups e rotina mensal |
| [docs/MANUAL_DO_USUARIO.md](docs/MANUAL_DO_USUARIO.md) | Como importar bases, consultar, orçar e emitir relatórios |
| [docs/PLANEJAMENTO.md](docs/PLANEJAMENTO.md) | Arquitetura, modelo do banco, diagrama ER, estratégias e cronograma |
| [docs/LAYOUTS_OFICIAIS.md](docs/LAYOUTS_OFICIAIS.md) | Estrutura dos arquivos EMOP e SINAPI verificada nos arquivos reais |
| [docs/REGRAS_DE_CALCULO.md](docs/REGRAS_DE_CALCULO.md) | Arredondamentos, BDI, conferência das composições |
| [docs/SEGURANCA.md](docs/SEGURANCA.md) | Controles de segurança e integridade |

## Para desenvolvedores

Requisitos: Node.js 22, PostgreSQL 16+ (com `pg_trgm` e `unaccent`).

```bash
cp .env.example .env            # ajuste DATABASE_URL, DIRECT_URL e TEST_DATABASE_URL
npm ci
npm run db:migrar && npm run db:seed
npm run usuario:criar -- --email voce@exemplo.com --nome "Seu Nome" --papel ADMINISTRADOR
npm run dev                     # http://localhost:3000
npm test                        # unitários + integração (usa TEST_DATABASE_URL, recriado a cada execução)
npm run importar -- --fonte EMOP --competencia 01/2026 EMOP_012026.rar --confirmar --publicar
```

Estrutura: `src/dominio` (regras puras), `src/importacao` (leitores e adaptadores), `src/servidor`
(serviços, autenticação), `src/relatorios`, `src/app` (telas e rotas), `prisma/migrations` (SQL, fonte da
verdade do modelo), `tests/`.
