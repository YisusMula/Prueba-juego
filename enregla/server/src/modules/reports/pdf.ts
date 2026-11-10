import PDFDocument from 'pdfkit';
import type { Organization } from '../../db/types.js';
import { RECORD_TYPE_LABELS, BUSINESS_TYPE_LABELS, type RecordType } from '../../schemas/index.js';
import { formatDateEs, formatDateTimeEs } from '../../lib/dates.js';
import { COLUMNS, formatRow, pdfText, type ReportRecord } from './format.js';

const COLOR = {
  text: '#1f2933',
  muted: '#616e7c',
  brand: '#0f766e',
  headerBg: '#e6f4f1',
  alertBg: '#fde8e8',
  alertText: '#9b1c1c',
  amendBg: '#fff8e1',
  border: '#cbd2d9',
};

/** Filas entre cesiones del event loop (cada fila cuesta ~1 ms de CPU). */
const YIELD_EVERY_ROWS = 20;
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface PdfInput {
  appName: string;
  org: Organization;
  from: string;
  to: string;
  types: RecordType[];
  /** Iterador de registros por tipo (en lotes, para no cargarlo todo en memoria). */
  records: (type: RecordType) => AsyncIterable<ReportRecord[]>;
  maxRows: number;
}

/**
 * Genera el informe y lo escribe en el documento, que es un stream legible.
 * La función devuelve el documento inmediatamente; el contenido se va
 * escribiendo de forma asíncrona y `doc.end()` se llama al terminar.
 */
export function createReportPdf(input: PdfInput, onError: (err: unknown) => void): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, bottom: 50, left: 36, right: 36 },
    info: {
      Title: pdfText(`Registros de autocontrol - ${input.org.name}`),
      Author: pdfText(input.appName),
      Creator: pdfText(input.appName),
    },
    bufferPages: false,
  });
  const tz = input.org.timezone;
  const generatedAt = formatDateTimeEs(new Date(), tz);
  let pageNo = 1;

  const footer = () => {
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 32;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLOR.muted)
      .text(pdfText(`${input.org.name} · Generado el ${generatedAt} con ${input.appName}`), doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 80,
        lineBreak: false,
      })
      .text(`Página ${pageNo}`, doc.page.width - doc.page.margins.right - 80, y, { width: 80, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
    doc.x = doc.page.margins.left;
  };
  doc.on('pageAdded', () => {
    pageNo += 1;
    footer();
    doc.y = doc.page.margins.top;
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

  async function render(): Promise<void> {
    footer();
    doc.y = doc.page.margins.top;
    // Cabecera
    doc.font('Helvetica-Bold').fontSize(18).fillColor(COLOR.brand).text(pdfText('Registros de autocontrol de higiene alimentaria'), left, doc.y, { width });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR.text).text(pdfText(input.org.name), { width });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLOR.muted)
      .text(pdfText(`${BUSINESS_TYPE_LABELS[input.org.business_type as keyof typeof BUSINESS_TYPE_LABELS] ?? input.org.business_type} · Zona horaria: ${tz}`), { width })
      .text(pdfText(`Periodo: del ${formatDateEs(input.from)} al ${formatDateEs(input.to)}`), { width })
      .text(pdfText(`Tipos incluidos: ${input.types.map((t) => RECORD_TYPE_LABELS[t]).join(', ')}`), { width });
    doc.moveDown(0.4);
    doc
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text(
        pdfText(
          'Documento generado a partir de los registros introducidos por el establecimiento. Los registros no se pueden modificar ni borrar: las correcciones figuran como enmiendas que referencian al registro original. Las filas destacadas en rojo indican valores fuera de los límites configurados por el local.',
        ),
        { width },
      );
    doc.moveDown(0.8);

    let totalRows = 0;
    for (const type of input.types) {
      const cols = COLUMNS[type];
      const totalWeight = cols.reduce((a, c) => a + c.weight, 0);
      const widths = cols.map((c) => (c.weight / totalWeight) * width);

      if (doc.y + 60 > bottomLimit()) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.brand).text(pdfText(RECORD_TYPE_LABELS[type]), left, doc.y, { width });
      doc.moveDown(0.3);

      const drawHeader = () => {
        doc.font('Helvetica-Bold').fontSize(8);
        const h = Math.max(...cols.map((c, i) => doc.heightOfString(pdfText(c.header), { width: widths[i]! - 6 }))) + 6;
        const y = doc.y;
        doc.rect(left, y, width, h).fill(COLOR.headerBg);
        let x = left;
        cols.forEach((c, i) => {
          doc.fillColor(COLOR.text).text(pdfText(c.header), x + 3, y + 3, { width: widths[i]! - 6 });
          x += widths[i]!;
        });
        doc.y = y + h;
      };
      drawHeader();

      let count = 0;
      for await (const batch of input.records(type)) {
        for (const r of batch) {
          if (totalRows >= input.maxRows) break;
          // Cede el event loop cada pocas filas: el resto de peticiones (y /healthz) siguen respondiendo.
          if (totalRows % YIELD_EVERY_ROWS === 0) {
            await yieldToEventLoop();
            if (doc.destroyed) return; // descarga cancelada: se deja de trabajar
          }
          const cells = formatRow(type, r, tz).map((c) => pdfText(c || '—'));
          doc.font('Helvetica').fontSize(8);
          const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i]! - 6 }))) + 6;
          if (doc.y + h > bottomLimit()) {
            doc.addPage();
            drawHeader();
            doc.font('Helvetica').fontSize(8);
          }
          const y = doc.y;
          const isAmendment = r.amends_record_id != null || r.amended_by != null;
          if (r.alert) doc.rect(left, y, width, h).fill(COLOR.alertBg);
          else if (isAmendment) doc.rect(left, y, width, h).fill(COLOR.amendBg);
          let x = left;
          cells.forEach((c, i) => {
            const isNotes = i === cells.length - 1 && isAmendment;
            doc
              .font(isNotes ? 'Helvetica-Oblique' : r.alert && i < 3 ? 'Helvetica-Bold' : 'Helvetica')
              .fillColor(r.alert ? COLOR.alertText : COLOR.text)
              .text(c, x + 3, y + 3, { width: widths[i]! - 6 });
            x += widths[i]!;
          });
          doc
            .moveTo(left, y + h)
            .lineTo(left + width, y + h)
            .lineWidth(0.4)
            .strokeColor(COLOR.border)
            .stroke();
          doc.y = y + h;
          count += 1;
          totalRows += 1;
        }
        if (totalRows >= input.maxRows) break;
      }
      doc.x = left;
      if (count === 0) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLOR.muted).text('Sin registros en el periodo.', left, doc.y + 4, { width });
      } else {
        doc.font('Helvetica').fontSize(8).fillColor(COLOR.muted).text(`${count} registro(s).`, left, doc.y + 4, { width });
      }
      doc.moveDown(1.2);
      if (totalRows >= input.maxRows) {
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(COLOR.alertText)
          .text(pdfText(`Informe truncado: se ha alcanzado el máximo de ${input.maxRows} filas. Reduce el periodo o los tipos seleccionados.`), left, doc.y, { width });
        break;
      }
    }
    doc.end();
  }

  render().catch((err: unknown) => {
    onError(err);
    doc.destroy(err instanceof Error ? err : new Error('Error generando el PDF'));
  });
  return doc;
}
