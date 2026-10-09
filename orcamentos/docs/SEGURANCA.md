# Segurança e integridade

| Controle | Implementação |
|---|---|
| Login | Argon2id (parâmetros OWASP); mensagem genérica; tempo constante para e-mail inexistente; bloqueio de 15 min após 5 erros por conta; limite de 20 tentativas/10 min por IP |
| Sessão | token aleatório de 256 bits em cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção; o banco guarda só o SHA-256 do token; expira em 12 h; troca/redefinição de senha encerra as outras sessões |
| Permissões | papéis × permissões no banco; verificadas no servidor em toda página, ação e rota de API |
| Credenciais do banco | somente variáveis de ambiente do servidor (nunca no navegador nem no Git; `.env` ignorado) |
| CSRF | Server Actions com verificação de origem do Next.js; rotas POST conferem `Origin` |
| Uploads | limite de tamanho e quantidade; tipo real pela assinatura binária; nomes saneados; limites contra "zip bomb" (ZIP e RAR); arquivos temporários apagados ao fim |
| SQL | consultas parametrizadas (inclusive SQL manual) |
| Auditoria | tabela somente-inserção (gatilho bloqueia UPDATE/DELETE): login, importações, publicações, alterações de orçamento, exportações, usuários |
| Imutabilidade | gatilhos do banco impedem alterar revisões de orçamento fechadas (e seus itens, etapas, BDI, cronograma) e dados de bases publicadas; versões de composição são imutáveis |
| Concorrência | versão otimista por revisão + `SELECT … FOR UPDATE` |
| Integridade de arquivos | SHA-256 de cada arquivo e pacote; reimportação exige permissão e justificativa |
| Cabeçalhos HTTP | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS |
| Backups | `pg_dump` semanal cifrado (AES-256) no GitHub Actions; restauração testada |

## Alertas conhecidos de dependências (`npm audit`)
Avaliados em out/2026; nenhum explorável no uso deste sistema:
- `postcss` embutido no Next.js: usado só na compilação do CSS do próprio projeto.
- `deepmerge-ts` (CLI do Prisma): usado só ao ler a configuração do Prisma na implantação.
- `uuid` < 11.1.1 (dependência do exceljs): a falha afeta as funções v3/v5/v6 com buffer, não usadas.
- `vitest`/`tinypool`: ferramentas de teste, não vão para produção.
Reavaliar a cada atualização (`npm audit --omit=dev`).
