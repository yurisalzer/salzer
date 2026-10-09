import ExcelJS from "exceljs";
import { D, type Decimal } from "@/dominio/decimal";
import type { Relatorio } from "./modelo";

const FORMATO: Record<string, string> = {
  moeda: '"R$" #,##0.00;[Red]-"R$" #,##0.00',
  numero2: "#,##0.00",
  numero4: "#,##0.0000",
  variavel: "#,##0.00######",
  percentual: '0.00"%"',
};

/** Gera XLSX com uma aba por relatório; valores numéricos ficam como números (somáveis no Excel). */
export async function gerarXlsx(r: Relatorio): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sistema de Orçamentos de Obras";
  wb.created = new Date();
  const ws = wb.addWorksheet(r.titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), {
    pageSetup: { orientation: r.paisagem === false ? "portrait" : "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.addRow([r.titulo]).font = { bold: true, size: 14, color: { argb: "FF123B69" } };
  for (const [k, v] of r.cabecalho) {
    const row = ws.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
  ws.addRow([]);
  for (const t of r.tabelas) {
    if (t.titulo) ws.addRow([t.titulo]).font = { bold: true, size: 12 };
    const h = ws.addRow(t.colunas.map((c) => c.titulo));
    h.eachCell((c) => {
      c.font = { bold: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      c.border = { bottom: { style: "thin" } };
    });
    for (const l of t.linhas) {
      const valores = l.celulas.map((cel, i) => {
        if (cel === null || cel === undefined) return null;
        if (typeof cel === "string") return cel;
        const f = t.colunas[i]?.formato;
        // Planilhas guardam números em ponto flutuante; os valores já vêm ajustados (2 casas).
        return f && f !== "texto" ? Number(D(cel as Decimal).toString()) : (cel as Decimal).toString();
      });
      const row = ws.addRow(valores);
      t.colunas.forEach((c, i) => {
        if (c.formato && FORMATO[c.formato]) row.getCell(i + 1).numFmt = FORMATO[c.formato]!;
      });
      if (l.estilo && l.estilo !== "normal") {
        row.font = { bold: true };
        if (l.estilo === "etapa" || l.estilo === "total") row.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: l.estilo === "total" ? "FFDFE7F3" : "FFEEF3FA" } }));
      }
      if (l.nivel && l.nivel > 1) row.getCell(4).alignment = { indent: l.nivel - 1, wrapText: true };
    }
    t.colunas.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.max(col.width ?? 0, c.formato === "texto" || !c.formato ? Math.min(60, (c.largura ?? 1) * 10) : 15);
      if (!c.formato || c.formato === "texto") col.alignment = { wrapText: true, vertical: "top" };
    });
    ws.addRow([]);
  }
  for (const n of r.notas) ws.addRow([n]).font = { italic: true, color: { argb: "FF475569" } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
