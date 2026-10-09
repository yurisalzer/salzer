import { exigirUsuario } from "@/servidor/sessao";
import { Assistente } from "./assistente";

export default async function NovaImportacao() {
  const u = await exigirUsuario("importacao.executar");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="titulo-pagina">Importar base de referência</h1>
        <p className="text-sm text-slate-500">Assistente de importação de arquivos oficiais EMOP-RJ e SINAPI</p>
      </div>
      <Assistente podeAutorizarDuplicidade={u.permissoes.has("importacao.autorizar_duplicidade")} limiteMb={Number(process.env.UPLOAD_MAX_MB ?? "200")} />
    </div>
  );
}
