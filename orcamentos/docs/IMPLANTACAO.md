# Guia de implantação (sem programação)

Tempo estimado: 40 minutos. Custo inicial: R$ 0 (planos gratuitos), sujeito às condições atuais de cada
provedor — **confira os limites e termos de uso comercial no momento da contratação**.

Você vai criar 3 contas: **Neon** (banco de dados), **Render** (servidor da aplicação) e usar o **GitHub**
(onde o código já está) para testes automáticos e backups.

---

## 1. Banco de dados no Neon

1. Acesse <https://neon.tech> e crie uma conta (pode entrar com a conta do GitHub).
2. Clique em **Create project**:
   - *Project name*: `orcamentos`
   - *Postgres version*: 16 ou 17
   - *Region*: **AWS São Paulo (sa-east-1)** se disponível; senão, a mais próxima.
3. No painel do projeto, clique em **Connect**. Você verá a *connection string*. Copie **duas versões**:
   - com **Connection pooling ligado** (o endereço contém `-pooler`) → será a `DATABASE_URL`;
   - com **Connection pooling desligado** → será a `DIRECT_URL`.
4. Guarde essas duas linhas num gerenciador de senhas. **Nunca** as cole em e-mail, chat ou no código.

> As tabelas são criadas automaticamente pelo sistema na primeira inicialização.

## 2. Aplicação no Render

1. Acesse <https://render.com> e entre com a conta do GitHub.
2. Clique em **New → Blueprint** e escolha o repositório `salzer`. O Render lê o arquivo `render.yaml`.
3. Preencha as variáveis pedidas:

| Variável | O que colocar |
|---|---|
| `DATABASE_URL` | connection string do Neon **com** `-pooler` |
| `DIRECT_URL` | connection string do Neon **sem** `-pooler` |
| `ADMIN_EMAIL` | seu e-mail (será o primeiro administrador) |
| `ADMIN_NOME` | seu nome |
| `ADMIN_SENHA_INICIAL` | uma senha provisória com 10+ caracteres, letras e números |

4. Clique em **Apply**. A primeira construção leva de 5 a 10 minutos. Ao final, o Render mostra o endereço
   (algo como `https://orcamentos-obras.onrender.com`).
5. Abra o endereço, entre com `ADMIN_EMAIL` e a senha provisória.
6. Vá em **Minha conta** e troque a senha. Depois, no Render, em *Environment*, **apague**
   `ADMIN_SENHA_INICIAL` e salve.

**Observações do plano gratuito do Render**: o serviço "dorme" após ~15 minutos sem uso; o primeiro acesso
seguinte demora cerca de 1 minuto. Memória de 512 MB: suficiente — a importação completa dos arquivos
EMOP e SINAPI de jan/2026 foi medida com pico de ~360 MB.

> **Por que não Vercel?** O plano gratuito da Vercel (Hobby) não permite uso comercial e limita o tempo de
> cada requisição, o que atrapalha as importações. O sistema funciona em qualquer serviço com Docker
> (Render, Google Cloud Run, Koyeb, um servidor próprio…).

## 3. Testes automáticos e backups no GitHub

### Testes
A cada alteração do código, o GitHub executa automaticamente todos os testes (aba **Actions**,
fluxo "Orçamentos — testes"). Nada a configurar.

### Backups semanais cifrados
1. No GitHub, abra o repositório → **Settings → Secrets and variables → Actions → New repository secret**.
2. Crie `BACKUP_DATABASE_URL` = a connection string **sem** `-pooler`.
3. Crie `BACKUP_SENHA` = uma senha longa (20+ caracteres). **Guarde-a fora do GitHub**: sem ela o backup
   não pode ser aberto.
4. Pronto: todo domingo é gerado um backup cifrado (aba **Actions → Orçamentos — backup do banco**),
   guardado por 90 dias. Para gerar um agora: *Run workflow*.

O Neon também mantém um histórico curto de restauração (point-in-time) no plano gratuito.

### Restaurar um backup
1. Baixe o artefato `backup-orcamentos-N` na aba Actions (arquivo `.dump.gpg`).
2. Crie um **banco novo e vazio** no Neon (novo projeto ou *branch*).
3. Num computador com PostgreSQL instalado, rode:
   ```
   DATABASE_URL="conexão do banco NOVO" BACKUP_SENHA="sua senha" bash orcamentos/scripts/restaurar.sh arquivo.dump.gpg
   ```
4. Confira os dados e só então troque `DATABASE_URL`/`DIRECT_URL` no Render.

(O procedimento foi testado: o banco restaurado ficou idêntico ao original.)

## 4. Rotina mensal

1. Baixe os arquivos oficiais do mês (EMOP: arquivo RAR do boletim; SINAPI: ZIP "formato xlsx" da Caixa).
2. No sistema: **Bases e importação → Importar nova base** e siga os 4 passos.
3. Leia o relatório da análise (erros, avisos e a conferência dos custos das composições).
4. **Confirmar e gravar** → **Publicar**. Só depois de publicada a base aparece para novos orçamentos.
5. Retificações: importe o novo arquivo da mesma competência; ele vira uma nova revisão (ex.: "Retificação 02")
   e substitui a anterior **sem apagá-la** — orçamentos antigos continuam com os preços que usaram.

## 5. Espaço no banco

O painel **Bases e importação** mostra o espaço ocupado. Estimativa: ~120 MB no primeiro mês com EMOP e
SINAPI completos e ~20 MB por mês seguinte (≈ 1,5 ano no limite gratuito de 0,5 GB). Para economizar,
importe só os regimes que usa (ex.: SINAPI sem o regime "sem encargos"). Acima de 70% o painel avisa.

## 6. Atualizações do sistema

Toda alteração enviada ao GitHub (branch configurado no Render) é testada e publicada automaticamente.
As migrações do banco são aplicadas sozinhas na inicialização e nunca apagam dados.
