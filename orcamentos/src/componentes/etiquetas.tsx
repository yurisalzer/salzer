const CORES: Record<string, string> = {
  PUBLICADA: "bg-emerald-100 text-emerald-800",
  VALIDADA: "bg-amber-100 text-amber-800",
  SUBSTITUIDA: "bg-slate-200 text-slate-700",
  REJEITADA: "bg-red-100 text-red-800",
  ANALISADO: "bg-sky-100 text-sky-800",
  IMPORTADO: "bg-emerald-100 text-emerald-800",
  FALHOU: "bg-red-100 text-red-800",
  CANCELADO: "bg-slate-200 text-slate-700",
  RECEBIDO: "bg-slate-100 text-slate-700",
  ERRO: "bg-red-100 text-red-800",
  AVISO: "bg-amber-100 text-amber-800",
  INFO: "bg-sky-100 text-sky-800",
  ABERTA: "bg-sky-100 text-sky-800",
  FECHADA: "bg-slate-700 text-white",
  INFORMADO: "bg-emerald-50 text-emerald-800",
  AUSENTE: "bg-amber-100 text-amber-800",
  SEM_CUSTO: "bg-amber-100 text-amber-800",
  SEM_PRECO: "bg-amber-100 text-amber-800",
};

const NOMES: Record<string, string> = {
  PUBLICADA: "Publicada", VALIDADA: "Aguardando publicação", SUBSTITUIDA: "Substituída", REJEITADA: "Rejeitada",
  ANALISADO: "Analisado", IMPORTADO: "Gravado", FALHOU: "Falhou", CANCELADO: "Cancelado", RECEBIDO: "Recebido",
  ABERTA: "Aberta", FECHADA: "Fechada", INFORMADO: "Informado", AUSENTE: "Sem preço no mês", SEM_CUSTO: "Sem custo", SEM_PRECO: "Sem preço",
};

export function Etiqueta({ valor, texto }: { valor: string; texto?: string }) {
  return <span className={`etiqueta ${CORES[valor] ?? "bg-slate-100 text-slate-700"}`}>{texto ?? NOMES[valor] ?? valor}</span>;
}
