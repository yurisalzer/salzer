import { exigirUsuario } from "@/servidor/sessao";
import { EditorComposicao } from "../editor";
import { basesVigentes } from "../bases";

export default async function NovaComposicao() {
  await exigirUsuario("composicoes.editar");
  const b = await basesVigentes();
  return (
    <div className="space-y-4">
      <h1 className="titulo-pagina">Nova composição própria</h1>
      <EditorComposicao inicial={{ itemId: null, codigo: "", descricao: "", unidade: "", componentes: [] }} revisoes={b.ids} rotulosRevisoes={b.rotulo} />
    </div>
  );
}
