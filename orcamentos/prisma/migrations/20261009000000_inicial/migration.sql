-- =====================================================================
-- Sistema de Orçamento de Obras — EMOP-RJ e SINAPI-RJ
-- Migração inicial (PostgreSQL 16+). Escrita à mão: contém gatilhos,
-- índices parciais e extensões que o Prisma não modela.
-- Convenções: UUID para identificadores internos; TEXT para códigos
-- oficiais; NUMERIC para valores; competência = dia 1 do mês.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() não é IMMUTABLE; este invólucro permite usá-lo em índices.
CREATE OR REPLACE FUNCTION f_normalizar_busca(texto text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, texto)) $$;

-- ---------------------------------------------------------------------
-- Usuários, permissões, sessões e auditoria
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome              text NOT NULL CHECK (length(trim(nome)) > 0),
  email             text NOT NULL UNIQUE CHECK (email = lower(email) AND email LIKE '%_@_%'),
  senha_hash        text NOT NULL,
  ativo             boolean NOT NULL DEFAULT true,
  tentativas_falhas integer NOT NULL DEFAULT 0,
  bloqueado_ate     timestamptz,
  ultimo_login_em   timestamptz,
  senha_alterada_em timestamptz NOT NULL DEFAULT now(),
  criado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE papeis (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo    text NOT NULL UNIQUE,
  nome      text NOT NULL,
  descricao text
);

CREATE TABLE permissoes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo    text NOT NULL UNIQUE,
  descricao text NOT NULL
);

CREATE TABLE papeis_permissoes (
  papel_id     uuid NOT NULL REFERENCES papeis(id) ON DELETE CASCADE,
  permissao_id uuid NOT NULL REFERENCES permissoes(id) ON DELETE CASCADE,
  PRIMARY KEY (papel_id, permissao_id)
);

CREATE TABLE usuarios_papeis (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  papel_id   uuid NOT NULL REFERENCES papeis(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, papel_id)
);

CREATE TABLE sessoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL,
  ultimo_uso_em timestamptz NOT NULL DEFAULT now(),
  ip            text,
  user_agent    text
);
CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);
CREATE INDEX idx_sessoes_expira ON sessoes(expira_em);

CREATE TABLE auditoria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  acao        text NOT NULL,
  entidade    text NOT NULL,
  entidade_id uuid,
  dados       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_entidade ON auditoria(entidade, entidade_id);
CREATE INDEX idx_auditoria_data ON auditoria(criado_em DESC);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id, criado_em DESC);

-- ---------------------------------------------------------------------
-- Fontes, regimes, bases mensais e revisões (original/retificações)
-- ---------------------------------------------------------------------
CREATE TABLE fontes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sigla     text NOT NULL UNIQUE CHECK (sigla IN ('EMOP', 'SINAPI', 'PROPRIA')),
  nome      text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE regimes (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[A-Z_]+$'),
  nome   text NOT NULL,
  ordem  integer NOT NULL DEFAULT 0
);

CREATE TABLE bases_referencia (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id    uuid NOT NULL REFERENCES fontes(id),
  uf          char(2) NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  competencia date NOT NULL CHECK (EXTRACT(DAY FROM competencia) = 1),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fonte_id, uf, competencia)
);
CREATE INDEX idx_bases_competencia ON bases_referencia(competencia DESC);

CREATE TABLE lotes_importacao (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id                  uuid NOT NULL REFERENCES fontes(id),
  uf                        char(2) NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  competencia               date NOT NULL CHECK (EXTRACT(DAY FROM competencia) = 1),
  regimes                   text[] NOT NULL,
  rotulo_revisao            text NOT NULL,
  adaptador                 text,
  importador_versao         text NOT NULL,
  status                    text NOT NULL DEFAULT 'RECEBIDO'
                            CHECK (status IN ('RECEBIDO', 'ANALISADO', 'IMPORTADO', 'FALHOU', 'CANCELADO')),
  contagens                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadados                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  erro                      text,
  duplicidade_justificativa text,
  usuario_id                uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  revisao_base_id           uuid,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  analisado_em              timestamptz,
  concluido_em              timestamptz
);
CREATE INDEX idx_lotes_fonte_comp ON lotes_importacao(fonte_id, uf, competencia);
CREATE INDEX idx_lotes_status ON lotes_importacao(status, criado_em DESC);

CREATE TABLE revisoes_base (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id          uuid NOT NULL REFERENCES bases_referencia(id),
  numero           integer NOT NULL CHECK (numero > 0),
  rotulo           text NOT NULL,
  status           text NOT NULL DEFAULT 'VALIDADA'
                   CHECK (status IN ('VALIDADA', 'PUBLICADA', 'REJEITADA', 'SUBSTITUIDA')),
  regimes          text[] NOT NULL,
  data_emissao     date,
  observacoes      text,
  lote_id          uuid REFERENCES lotes_importacao(id),
  criada_em        timestamptz NOT NULL DEFAULT now(),
  publicada_em     timestamptz,
  publicada_por    uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  rejeitada_em     timestamptz,
  motivo_rejeicao  text,
  substituida_em   timestamptz,
  UNIQUE (base_id, numero),
  CHECK (status <> 'PUBLICADA' OR publicada_em IS NOT NULL),
  CHECK (status <> 'REJEITADA' OR motivo_rejeicao IS NOT NULL)
);
-- No máximo uma revisão vigente (PUBLICADA) por base mensal.
CREATE UNIQUE INDEX uq_revisao_base_publicada ON revisoes_base(base_id) WHERE status = 'PUBLICADA';
CREATE INDEX idx_revisoes_base_status ON revisoes_base(status);

ALTER TABLE lotes_importacao
  ADD CONSTRAINT fk_lote_revisao_base FOREIGN KEY (revisao_base_id) REFERENCES revisoes_base(id);

CREATE TABLE arquivos_importacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id        uuid NOT NULL REFERENCES lotes_importacao(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  caminho        text NOT NULL,
  pacote_sha256  text CHECK (pacote_sha256 ~ '^[0-9a-f]{64}$'),
  tamanho        bigint NOT NULL CHECK (tamanho >= 0),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  assinatura     text NOT NULL,
  layout         text,
  papel          text,
  registros      integer,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_arquivos_sha ON arquivos_importacao(sha256);
CREATE INDEX idx_arquivos_lote ON arquivos_importacao(lote_id);

CREATE TABLE verificacoes_importacao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id    uuid NOT NULL REFERENCES lotes_importacao(id) ON DELETE CASCADE,
  regra      text NOT NULL,
  severidade text NOT NULL CHECK (severidade IN ('ERRO', 'AVISO', 'INFO')),
  mensagem   text NOT NULL,
  arquivo    text,
  linha      integer,
  codigo     text,
  detalhes   jsonb,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_verificacoes_lote ON verificacoes_importacao(lote_id, severidade);

-- Staging: tabelas UNLOGGED (rápidas, sem WAL). Dados brutos de um lote,
-- com arquivo/linha de origem; apagados após confirmação ou cancelamento.
CREATE UNLOGGED TABLE stg_itens (
  lote_id                     uuid NOT NULL,
  arquivo                     text NOT NULL,
  linha                       integer NOT NULL,
  tipo                        text NOT NULL,
  codigo                      text NOT NULL,
  descricao                   text,
  unidade                     text,
  classe                      text,
  grupo                       text,
  regime_codigo               text,
  codigo_composicao_vinculada text
);
CREATE INDEX idx_stg_itens_lote ON stg_itens(lote_id, tipo, codigo);

CREATE UNLOGGED TABLE stg_precos (
  lote_id             uuid NOT NULL,
  arquivo             text NOT NULL,
  linha               integer NOT NULL,
  regime_codigo       text NOT NULL,
  tipo                text NOT NULL,
  codigo              text NOT NULL,
  preco_texto         text,
  preco               numeric(20, 6),
  situacao            text NOT NULL,
  origem_preco        text,
  percentual_as       numeric(12, 8),
  percentual_mao_obra numeric(12, 8)
);
CREATE INDEX idx_stg_precos_lote ON stg_precos(lote_id, tipo, codigo);

CREATE UNLOGGED TABLE stg_componentes (
  lote_id          uuid NOT NULL,
  arquivo          text NOT NULL,
  linha            integer NOT NULL,
  codigo_pai       text NOT NULL,
  ordem            integer NOT NULL,
  sequencia        text,
  tipo_item        text NOT NULL,
  codigo_item      text NOT NULL,
  coeficiente      numeric(24, 10),
  coeficiente_texto text,
  percentual_perda numeric(12, 8),
  situacao_origem  text
);
CREATE INDEX idx_stg_componentes_lote ON stg_componentes(lote_id, codigo_pai);

CREATE UNLOGGED TABLE stg_composicoes (
  lote_id  uuid NOT NULL,
  arquivo  text NOT NULL,
  linha    integer NOT NULL,
  codigo   text NOT NULL,
  situacao text
);
CREATE INDEX idx_stg_composicoes_lote ON stg_composicoes(lote_id, codigo);

-- Atributos complementares por item e regime (ex.: % de mão de obra do SINAPI)
CREATE UNLOGGED TABLE stg_atributos (
  lote_id       uuid NOT NULL,
  arquivo       text NOT NULL,
  linha         integer NOT NULL,
  regime_codigo text NOT NULL,
  tipo          text NOT NULL,
  codigo        text NOT NULL,
  atributo      text NOT NULL,
  valor         numeric(20, 8)
);
CREATE INDEX idx_stg_atributos_lote ON stg_atributos(lote_id, atributo, tipo, codigo);

CREATE UNLOGGED TABLE stg_manutencoes (
  lote_id     uuid NOT NULL,
  linha       integer NOT NULL,
  referencia  date,
  tipo        text,
  codigo      text,
  descricao   text,
  manutencao  text
);
CREATE INDEX idx_stg_manutencoes_lote ON stg_manutencoes(lote_id);

-- ---------------------------------------------------------------------
-- Catálogo, preços históricos e composições versionadas
-- ---------------------------------------------------------------------
CREATE TABLE itens_referencia (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id                    uuid NOT NULL REFERENCES fontes(id),
  tipo                        text NOT NULL CHECK (tipo IN ('INSUMO', 'COMPOSICAO')),
  codigo                      text NOT NULL CHECK (length(codigo) > 0 AND codigo = btrim(codigo)),
  descricao                   text NOT NULL,
  unidade                     text NOT NULL,
  classe                      text,
  grupo                       text,
  regime_codigo               text REFERENCES regimes(codigo),
  codigo_composicao_vinculada text,
  criado_por                  uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  atualizado_em               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fonte_id, tipo, codigo)
);
-- Busca por código (prefixo) e por palavras da descrição (trigramas, sem acento).
CREATE INDEX idx_itens_codigo ON itens_referencia(codigo text_pattern_ops);
CREATE INDEX idx_itens_descricao_trgm ON itens_referencia USING gin (f_normalizar_busca(descricao) gin_trgm_ops);

CREATE TABLE descricoes_item (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id   uuid NOT NULL REFERENCES itens_referencia(id),
  descricao text NOT NULL,
  unidade   text NOT NULL,
  hash      text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, hash)
);

CREATE TABLE precos_referencia (
  revisao_base_id     uuid NOT NULL REFERENCES revisoes_base(id),
  regime_codigo       text NOT NULL REFERENCES regimes(codigo),
  item_id             uuid NOT NULL REFERENCES itens_referencia(id),
  descricao_id        uuid NOT NULL REFERENCES descricoes_item(id),
  preco               numeric(20, 6),
  situacao            text NOT NULL CHECK (situacao IN ('INFORMADO', 'AUSENTE', 'SEM_CUSTO', 'SEM_PRECO')),
  origem_preco        text,
  percentual_as       numeric(12, 8),
  percentual_mao_obra numeric(12, 8),
  linha_origem        integer,
  -- Ordem da chave: atende a busca de preço de um item numa revisão E o histórico do item
  -- com um único índice (economia de espaço).
  PRIMARY KEY (item_id, revisao_base_id, regime_codigo),
  -- Preço ausente nunca é gravado como zero: só INFORMADO tem valor.
  CHECK ((situacao = 'INFORMADO') = (preco IS NOT NULL)),
  CHECK (preco IS NULL OR preco >= 0)
);

CREATE TABLE composicoes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                  uuid NOT NULL REFERENCES itens_referencia(id),
  origem                   text NOT NULL CHECK (origem IN ('OFICIAL', 'PROPRIA')),
  hash_conteudo            text NOT NULL,
  versao                   integer NOT NULL DEFAULT 1,
  primeira_revisao_base_id uuid REFERENCES revisoes_base(id),
  observacao               text,
  criada_por               uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criada_em                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, hash_conteudo)
);

CREATE TABLE composicao_itens (
  composicao_id            uuid NOT NULL REFERENCES composicoes(id) ON DELETE CASCADE,
  ordem                    integer NOT NULL CHECK (ordem > 0),
  sequencia                text,
  tipo_item                text NOT NULL CHECK (tipo_item IN ('INSUMO', 'COMPOSICAO')),
  item_id                  uuid REFERENCES itens_referencia(id),
  codigo_original          text NOT NULL,
  coeficiente              numeric(24, 10) NOT NULL CHECK (coeficiente >= 0),
  percentual_perda         numeric(12, 8),
  situacao_origem          text,
  -- Somente composições próprias: de onde vem o preço do componente
  revisao_base_id          uuid REFERENCES revisoes_base(id),
  regime_codigo            text REFERENCES regimes(codigo),
  custo_unitario_informado numeric(20, 6) CHECK (custo_unitario_informado IS NULL OR custo_unitario_informado >= 0),
  descricao_informada      text,
  unidade_informada        text,
  PRIMARY KEY (composicao_id, ordem),
  CHECK (item_id IS NOT NULL OR custo_unitario_informado IS NOT NULL)
);
CREATE INDEX idx_composicao_itens_item ON composicao_itens(item_id);

CREATE TABLE composicoes_publicadas (
  revisao_base_id uuid NOT NULL REFERENCES revisoes_base(id),
  item_id         uuid NOT NULL REFERENCES itens_referencia(id),
  composicao_id   uuid NOT NULL REFERENCES composicoes(id),
  situacao        text,
  PRIMARY KEY (revisao_base_id, item_id)
);
CREATE INDEX idx_composicoes_publicadas_comp ON composicoes_publicadas(composicao_id);

CREATE TABLE manutencoes_sinapi (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisao_base_id uuid NOT NULL REFERENCES revisoes_base(id),
  referencia      date,
  tipo            text,
  codigo          text,
  descricao       text,
  manutencao      text
);
CREATE INDEX idx_manutencoes_codigo ON manutencoes_sinapi(codigo);

-- ---------------------------------------------------------------------
-- Obras, orçamentos, revisões, etapas, itens, BDI e cronograma
-- ---------------------------------------------------------------------
CREATE TABLE obras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL CHECK (length(trim(nome)) > 0),
  cliente       text,
  municipio     text,
  uf            char(2) NOT NULL DEFAULT 'RJ' CHECK (uf ~ '^[A-Z]{2}$'),
  endereco      text,
  descricao     text,
  criado_por    uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orcamentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       uuid NOT NULL REFERENCES obras(id),
  codigo        text,
  nome          text NOT NULL CHECK (length(trim(nome)) > 0),
  descricao     text,
  criado_por    uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_orcamentos_obra ON orcamentos(obra_id);

CREATE TABLE perfis_bdi (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               text NOT NULL UNIQUE,
  descricao          text,
  tipo_obra          text,
  regime_codigo      text REFERENCES regimes(codigo),
  faixa              text,
  percentual_adotado numeric(12, 6) CHECK (percentual_adotado IS NULL OR percentual_adotado >= 0),
  fonte_documento    text,
  ativo              boolean NOT NULL DEFAULT true,
  criado_por         uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parcelas_bdi (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id  uuid NOT NULL REFERENCES perfis_bdi(id) ON DELETE CASCADE,
  codigo     text NOT NULL CHECK (codigo IN ('AC', 'S', 'G', 'SG', 'R', 'DF', 'L', 'PIS', 'COFINS', 'ISS', 'CPRB', 'OUTROS_TRIBUTOS')),
  nome       text NOT NULL,
  -- Em pontos percentuais (3,000000 = 3%)
  percentual numeric(12, 6) NOT NULL CHECK (percentual >= 0 AND percentual < 100),
  ordem      integer NOT NULL DEFAULT 0,
  UNIQUE (perfil_id, codigo)
);

CREATE TABLE revisoes_orcamento (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id        uuid NOT NULL REFERENCES orcamentos(id),
  numero              integer NOT NULL CHECK (numero > 0),
  status              text NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA', 'FECHADA')),
  descricao           text,
  versao              integer NOT NULL DEFAULT 1,
  modo_arredondamento text NOT NULL DEFAULT 'TRUNCAR' CHECK (modo_arredondamento IN ('TRUNCAR', 'ARREDONDAR')),
  prazo_meses         integer CHECK (prazo_meses IS NULL OR prazo_meses BETWEEN 1 AND 120),
  revisao_origem_id   uuid REFERENCES revisoes_orcamento(id),
  bdi_padrao_id       uuid,
  total_custo         numeric(20, 2),
  total_bdi           numeric(20, 2),
  total_geral         numeric(20, 2),
  fechada_em          timestamptz,
  fechada_por         uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  hash_fechamento     text,
  criado_por          uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (orcamento_id, numero),
  CHECK (status <> 'FECHADA' OR (fechada_em IS NOT NULL AND total_geral IS NOT NULL AND hash_fechamento IS NOT NULL))
);

CREATE TABLE bdi_aplicados (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisao_id           uuid NOT NULL REFERENCES revisoes_orcamento(id) ON DELETE CASCADE,
  perfil_origem_id     uuid REFERENCES perfis_bdi(id) ON DELETE SET NULL,
  nome                 text NOT NULL,
  parcelas             jsonb NOT NULL DEFAULT '[]'::jsonb,
  percentual_calculado numeric(12, 6),
  percentual_adotado   numeric(12, 6) NOT NULL CHECK (percentual_adotado >= 0),
  criado_em            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bdi_aplicados_revisao ON bdi_aplicados(revisao_id);

ALTER TABLE revisoes_orcamento
  ADD CONSTRAINT fk_revisao_bdi_padrao FOREIGN KEY (bdi_padrao_id) REFERENCES bdi_aplicados(id) ON DELETE SET NULL;

CREATE TABLE revisoes_orcamento_bases (
  revisao_id      uuid NOT NULL REFERENCES revisoes_orcamento(id) ON DELETE CASCADE,
  fonte_id        uuid NOT NULL REFERENCES fontes(id),
  revisao_base_id uuid NOT NULL REFERENCES revisoes_base(id),
  regime_codigo   text NOT NULL REFERENCES regimes(codigo),
  PRIMARY KEY (revisao_id, fonte_id)
);

CREATE TABLE etapas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisao_id uuid NOT NULL REFERENCES revisoes_orcamento(id) ON DELETE CASCADE,
  pai_id     uuid REFERENCES etapas(id) ON DELETE CASCADE,
  ordem      integer NOT NULL CHECK (ordem > 0),
  titulo     text NOT NULL CHECK (length(trim(titulo)) > 0),
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etapas_revisao ON etapas(revisao_id, pai_id, ordem);

CREATE TABLE itens_orcamento (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisao_id          uuid NOT NULL REFERENCES revisoes_orcamento(id) ON DELETE CASCADE,
  etapa_id            uuid NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  ordem               integer NOT NULL CHECK (ordem > 0),
  tipo                text NOT NULL CHECK (tipo IN ('REFERENCIA', 'PROPRIO')),
  item_referencia_id  uuid REFERENCES itens_referencia(id),
  revisao_base_id     uuid REFERENCES revisoes_base(id),
  regime_codigo       text REFERENCES regimes(codigo),
  composicao_id       uuid REFERENCES composicoes(id),
  -- Instantâneo dos dados de referência no momento do uso
  fonte_sigla         text NOT NULL,
  competencia         date,
  rotulo_revisao_base text,
  codigo              text NOT NULL,
  descricao           text NOT NULL,
  unidade             text NOT NULL,
  custo_unitario      numeric(20, 6),
  situacao_preco      text NOT NULL DEFAULT 'INFORMADO',
  quantidade          numeric(20, 6) NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  bdi_aplicado_id     uuid REFERENCES bdi_aplicados(id),
  bdi_percentual      numeric(12, 6) NOT NULL DEFAULT 0,
  preco_unitario      numeric(20, 2),
  total               numeric(20, 2),
  observacao          text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo <> 'REFERENCIA' OR (item_referencia_id IS NOT NULL AND revisao_base_id IS NOT NULL AND regime_codigo IS NOT NULL)),
  CHECK (custo_unitario IS NULL OR custo_unitario >= 0)
);
CREATE INDEX idx_itens_orcamento_revisao ON itens_orcamento(revisao_id, etapa_id, ordem);
CREATE INDEX idx_itens_orcamento_ref ON itens_orcamento(item_referencia_id);

CREATE TABLE cronograma (
  revisao_id uuid NOT NULL REFERENCES revisoes_orcamento(id) ON DELETE CASCADE,
  etapa_id   uuid NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  mes        integer NOT NULL CHECK (mes BETWEEN 1 AND 120),
  percentual numeric(9, 4) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
  PRIMARY KEY (etapa_id, mes)
);

CREATE TABLE fechamento_insumos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisao_id         uuid NOT NULL REFERENCES revisoes_orcamento(id) ON DELETE CASCADE,
  item_orcamento_id  uuid NOT NULL REFERENCES itens_orcamento(id) ON DELETE CASCADE,
  ordem              integer NOT NULL,
  nivel              integer NOT NULL,
  tipo_item          text NOT NULL,
  fonte_sigla        text NOT NULL,
  codigo             text NOT NULL,
  descricao          text NOT NULL,
  unidade            text NOT NULL,
  coeficiente        numeric(30, 12) NOT NULL,
  custo_unitario     numeric(20, 6),
  revisao_base_id    uuid REFERENCES revisoes_base(id),
  regime_codigo      text
);
CREATE INDEX idx_fechamento_revisao ON fechamento_insumos(revisao_id, item_orcamento_id, ordem);

-- =====================================================================
-- Gatilhos de integridade
-- =====================================================================

-- 1) Revisão de orçamento FECHADA é imutável (e seus filhos também).
CREATE OR REPLACE FUNCTION trg_bloquear_filhos_revisao_fechada() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_revisao uuid;
  v_status  text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_revisao := OLD.revisao_id; ELSE v_revisao := NEW.revisao_id; END IF;
  SELECT status INTO v_status FROM revisoes_orcamento WHERE id = v_revisao;
  IF v_status = 'FECHADA' THEN
    RAISE EXCEPTION 'Revisão de orçamento fechada não pode ser alterada (tabela %)', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.revisao_id <> OLD.revisao_id THEN
    RAISE EXCEPTION 'Não é permitido mover registros entre revisões' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_etapas_fechada BEFORE INSERT OR UPDATE OR DELETE ON etapas
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_filhos_revisao_fechada();
CREATE TRIGGER trg_itens_orcamento_fechada BEFORE INSERT OR UPDATE OR DELETE ON itens_orcamento
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_filhos_revisao_fechada();
CREATE TRIGGER trg_cronograma_fechada BEFORE INSERT OR UPDATE OR DELETE ON cronograma
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_filhos_revisao_fechada();
CREATE TRIGGER trg_bases_orc_fechada BEFORE INSERT OR UPDATE OR DELETE ON revisoes_orcamento_bases
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_filhos_revisao_fechada();
CREATE TRIGGER trg_bdi_aplicados_fechada BEFORE INSERT OR UPDATE OR DELETE ON bdi_aplicados
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_filhos_revisao_fechada();
CREATE TRIGGER trg_fechamento_insumos_fechada BEFORE INSERT OR UPDATE OR DELETE ON fechamento_insumos
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_filhos_revisao_fechada();

CREATE OR REPLACE FUNCTION trg_revisao_orcamento_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'FECHADA' THEN
      RAISE EXCEPTION 'Revisão de orçamento fechada não pode ser excluída' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'FECHADA' THEN
    RAISE EXCEPTION 'Revisão de orçamento fechada não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_revisoes_orcamento_imutavel BEFORE UPDATE OR DELETE ON revisoes_orcamento
  FOR EACH ROW EXECUTE FUNCTION trg_revisao_orcamento_imutavel();

-- 2) Dados de uma revisão de base publicada (ou substituída) são imutáveis.
CREATE OR REPLACE FUNCTION trg_bloquear_base_publicada() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_rev    uuid;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_rev := OLD.revisao_base_id; ELSE v_rev := NEW.revisao_base_id; END IF;
  SELECT status INTO v_status FROM revisoes_base WHERE id = v_rev;
  IF v_status IN ('PUBLICADA', 'SUBSTITUIDA') THEN
    RAISE EXCEPTION 'Revisão de base publicada não pode ser alterada (tabela %)', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_precos_publicada BEFORE INSERT OR UPDATE OR DELETE ON precos_referencia
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_base_publicada();
CREATE TRIGGER trg_comp_publicadas_publicada BEFORE INSERT OR UPDATE OR DELETE ON composicoes_publicadas
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_base_publicada();
CREATE TRIGGER trg_manutencoes_publicada BEFORE INSERT OR UPDATE OR DELETE ON manutencoes_sinapi
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_base_publicada();

-- Transições de status permitidas para revisões de base.
CREATE OR REPLACE FUNCTION trg_status_revisao_base() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('PUBLICADA', 'SUBSTITUIDA') THEN
      RAISE EXCEPTION 'Revisão de base publicada não pode ser excluída' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.base_id <> OLD.base_id OR NEW.numero <> OLD.numero THEN
    RAISE EXCEPTION 'Identificação da revisão de base é imutável' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> NEW.status AND NOT (
       (OLD.status = 'VALIDADA'  AND NEW.status IN ('PUBLICADA', 'REJEITADA')) OR
       (OLD.status = 'PUBLICADA' AND NEW.status = 'SUBSTITUIDA')
     ) THEN
    RAISE EXCEPTION 'Transição de status inválida: % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_revisoes_base_status BEFORE UPDATE OR DELETE ON revisoes_base
  FOR EACH ROW EXECUTE FUNCTION trg_status_revisao_base();

-- 3) Versões de composição nunca são editadas (cria-se nova versão).
CREATE OR REPLACE FUNCTION trg_bloquear_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registros de % são imutáveis; crie uma nova versão', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER trg_composicao_itens_imutavel BEFORE UPDATE ON composicao_itens
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_update();
CREATE TRIGGER trg_composicoes_imutavel BEFORE UPDATE ON composicoes
  FOR EACH ROW EXECUTE FUNCTION trg_bloquear_update();

-- 4) Itens de orçamento só usam bases publicadas (ou substituídas, em revisões antigas).
CREATE OR REPLACE FUNCTION trg_item_orcamento_base_publicada() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  IF NEW.revisao_base_id IS NOT NULL THEN
    SELECT status INTO v_status FROM revisoes_base WHERE id = NEW.revisao_base_id;
    IF v_status NOT IN ('PUBLICADA', 'SUBSTITUIDA') THEN
      RAISE EXCEPTION 'Base de referência ainda não publicada não pode ser usada em orçamentos'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_itens_orcamento_base BEFORE INSERT OR UPDATE OF revisao_base_id ON itens_orcamento
  FOR EACH ROW EXECUTE FUNCTION trg_item_orcamento_base_publicada();
CREATE TRIGGER trg_bases_orc_publicada BEFORE INSERT OR UPDATE OF revisao_base_id ON revisoes_orcamento_bases
  FOR EACH ROW EXECUTE FUNCTION trg_item_orcamento_base_publicada();

-- 5) Auditoria é somente-inserção.
CREATE OR REPLACE FUNCTION trg_auditoria_somente_insercao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria não podem ser alterados ou excluídos' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER trg_auditoria_imutavel BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria_somente_insercao();

-- =====================================================================
-- Dados de referência fixos
-- =====================================================================
INSERT INTO fontes (sigla, nome) VALUES
  ('EMOP', 'EMOP-RJ — Empresa de Obras Públicas do Estado do Rio de Janeiro'),
  ('SINAPI', 'SINAPI — Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil'),
  ('PROPRIA', 'Composições e serviços próprios');

INSERT INTO regimes (codigo, nome, ordem) VALUES
  ('SEM_DESONERACAO', 'Sem desoneração', 1),
  ('COM_DESONERACAO', 'Com desoneração', 2),
  ('SEM_ENCARGOS', 'Sem encargos sociais', 3),
  ('NAO_SE_APLICA', 'Não se aplica (itens próprios)', 9);
