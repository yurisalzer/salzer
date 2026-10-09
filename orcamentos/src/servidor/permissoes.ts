/** Catálogo de permissões e papéis padrão (gravados no banco pelo seed). */
export const PERMISSOES = {
  "bases.consultar": "Consultar bases de referência, preços e composições",
  "importacao.executar": "Importar arquivos oficiais",
  "importacao.autorizar_duplicidade": "Autorizar reimportação de arquivo já importado",
  "bases.publicar": "Publicar ou rejeitar revisões de bases importadas",
  "orcamentos.ver": "Ver obras e orçamentos",
  "orcamentos.editar": "Criar e editar obras, orçamentos e revisões abertas",
  "orcamentos.fechar": "Fechar revisões de orçamento",
  "composicoes.editar": "Criar composições próprias",
  "bdi.editar": "Criar e editar perfis de BDI",
  "relatorios.exportar": "Exportar relatórios em PDF e XLSX",
  "usuarios.gerenciar": "Gerenciar usuários e papéis",
  "auditoria.ver": "Consultar a trilha de auditoria",
} as const;

export type Permissao = keyof typeof PERMISSOES;

export const PAPEIS: Record<string, { nome: string; descricao: string; permissoes: Permissao[] }> = {
  ADMINISTRADOR: {
    nome: "Administrador",
    descricao: "Acesso total, inclusive usuários e auditoria",
    permissoes: Object.keys(PERMISSOES) as Permissao[],
  },
  GESTOR_BASES: {
    nome: "Gestor de bases",
    descricao: "Importa, valida e publica bases EMOP/SINAPI",
    permissoes: ["bases.consultar", "importacao.executar", "bases.publicar", "orcamentos.ver", "relatorios.exportar"],
  },
  ORCAMENTISTA: {
    nome: "Orçamentista",
    descricao: "Elabora orçamentos, composições próprias e BDI",
    permissoes: [
      "bases.consultar", "orcamentos.ver", "orcamentos.editar", "orcamentos.fechar",
      "composicoes.editar", "bdi.editar", "relatorios.exportar",
    ],
  },
  CONSULTA: {
    nome: "Consulta",
    descricao: "Somente leitura",
    permissoes: ["bases.consultar", "orcamentos.ver", "relatorios.exportar"],
  },
};
