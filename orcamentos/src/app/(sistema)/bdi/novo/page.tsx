import { exigirUsuario } from "@/servidor/sessao";
import { CODIGOS_PARCELA, NOMES_PARCELA } from "@/dominio/bdi";
import { FormAcao } from "@/componentes/form-acao";
import { acaoCriarPerfil } from "../acoes";

export default async function NovoPerfil() {
  await exigirUsuario("bdi.editar");
  return (
    <div className="space-y-4">
      <h1 className="titulo-pagina">Novo perfil de BDI</h1>
      <FormAcao acao={acaoCriarPerfil} className="cartao grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2"><label className="rotulo">Nome</label><input name="nome" className="campo" required /></div>
        <div><label className="rotulo">Tipo de obra</label><input name="tipo" className="campo" /></div>
        <div><label className="rotulo">Regime</label><select name="regime" className="campo" defaultValue=""><option value="">—</option><option value="SEM_DESONERACAO">Sem desoneração</option><option value="COM_DESONERACAO">Com desoneração</option></select></div>
        <div className="md:col-span-4 text-sm font-semibold">Parcelas (%)</div>
        {CODIGOS_PARCELA.map((c) => (
          <div key={c}><label className="rotulo">{NOMES_PARCELA[c]} ({c})</label><input name={c} className="campo text-right" inputMode="decimal" placeholder="0,00" /></div>
        ))}
        <div><label className="rotulo">Percentual adotado (%)</label><input name="adotado" className="campo text-right" placeholder="vazio = calculado, 2 casas" /></div>
        <div className="md:col-span-3"><label className="rotulo">Documento de referência</label><input name="documento" className="campo" placeholder="ex.: Acórdão TCU 2622/2013, edital nº…" /></div>
        <div className="md:col-span-4"><label className="rotulo">Descrição</label><input name="descricao" className="campo" /></div>
        <div><button className="btn-primario">Criar perfil</button></div>
      </FormAcao>
    </div>
  );
}
