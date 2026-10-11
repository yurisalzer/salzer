import PdfPrinter from "pdfmake";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import vfs from "pdfmake/build/vfs_fonts.js";
import type { Relatorio } from "./modelo";
import { textoCelula } from "./formatos";

const fonte = (n: string) => Buffer.from((vfs as unknown as Record<string, string>)[n]!, "base64");
const impressora = new PdfPrinter({
  Roboto: { normal: fonte("Roboto-Regular.ttf"), bold: fonte("Roboto-Medium.ttf"), italics: fonte("Roboto-Italic.ttf"), bolditalics: fonte("Roboto-MediumItalic.ttf") },
});

const NUMERICOS = new Set(["moeda", "numero2", "numero4", "variavel", "percentual"]);

export async function gerarPdf(r: Relatorio): Promise<Buffer> {
  const conteudo: Content[] = [
    { text: r.titulo, style: "titulo" },
    {
      table: { widths: ["auto", "*"], body: r.cabecalho.map(([k, v]) => [{ text: k, bold: true }, v]) },
      layout: "noBorders", fontSize: 8, margin: [0, 0, 0, 8],
    },
  ];
  for (const t of r.tabelas) {
    if (t.titulo) conteudo.push({ text: t.titulo, style: "subtitulo" });
    const somaLarg = t.colunas.reduce((acc, c) => acc + (c.largura ?? 1), 0);
    const larguras = t.colunas.map((c) => `${(((c.largura ?? 1) / somaLarg) * 100).toFixed(2)}%`);
    const corpo: TableCell[][] = [
      t.colunas.map((c) => ({ text: c.titulo, style: "th", alignment: NUMERICOS.has(c.formato ?? "texto") ? "right" : "left" })),
      ...t.linhas.map((l) =>
        l.celulas.map((cel, i) => {
          const col = t.colunas[i]!;
          const destaque = l.estilo && l.estilo !== "normal";
          return {
            text: textoCelula(cel, col.formato),
            alignment: NUMERICOS.has(col.formato ?? "texto") ? "right" : "left",
            bold: destaque,
            fillColor: l.estilo === "etapa" ? "#eef3fa" : l.estilo === "total" ? "#dfe7f3" : l.estilo === "titulo" ? "#f1f5f9" : undefined,
            margin: i === 3 && l.nivel ? [(l.nivel - 1) * 6, 0, 0, 0] : undefined,
          } as TableCell;
        }),
      ),
    ];
    conteudo.push({
      table: { headerRows: 1, widths: larguras, body: corpo, dontBreakRows: true },
      layout: { hLineWidth: () => 0.3, vLineWidth: () => 0.3, hLineColor: () => "#cbd5e1", vLineColor: () => "#cbd5e1", paddingTop: () => 2, paddingBottom: () => 2 },
      fontSize: 7, margin: [0, 0, 0, 10],
    });
  }
  if (r.notas.length) conteudo.push({ ul: r.notas, fontSize: 7, color: "#475569" });

  const def: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: r.paisagem === false ? "portrait" : "landscape",
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: "Roboto", fontSize: 8 },
    styles: {
      titulo: { fontSize: 13, bold: true, margin: [0, 0, 0, 6], color: "#123b69" },
      subtitulo: { fontSize: 10, bold: true, margin: [0, 6, 0, 4] },
      th: { bold: true, fillColor: "#e2e8f0" },
    },
    content: conteudo,
    footer: (pagina, total) => ({
      columns: [
        { text: `${r.titulo} — ${r.cabecalho.find(([k]) => k === "Obra")?.[1] ?? ""}`, fontSize: 7, color: "#64748b" },
        { text: `Página ${pagina} de ${total}`, alignment: "right", fontSize: 7, color: "#64748b" },
      ],
      margin: [28, 10, 28, 0],
    }),
    info: { title: r.titulo, creator: "Sistema de Orçamentos de Obras" },
  };
  const doc = impressora.createPdfKitDocument(def);
  const partes: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (p: Buffer) => partes.push(p));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    doc.end();
  });
}
