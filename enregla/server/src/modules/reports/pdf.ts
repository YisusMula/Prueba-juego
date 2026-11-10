import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import * as fontkit from 'fontkit';
import type { Organization } from '../../db/types.js';
import { RECORD_TYPE_LABELS, BUSINESS_TYPE_LABELS, type RecordType, timezoneLabel } from '../../schemas/index.js';
import { formatDateEs, formatDateTimeEs } from '../../lib/dates.js';
import { COLUMNS, formatRow, pdfText as sanitize, type ReportRecord } from './format.js';

/**
 * Fuente Unicode embebida (DejaVu Sans, licencia libre: assets/fonts/LICENSE-DejaVu.txt).
 * Cubre latín extendido (ș, ł, ő…), griego y cirílico; lo que no cubre (emojis…) se sustituye
 * por un marcador. La misma ruta sirve desde src/ (tsx) y desde dist/ (compilado).
 */
export const FONT_PATHS = {
  regular: fileURLToPath(new URL('../../../assets/fonts/DejaVuSans.ttf', import.meta.url)),
  bold: fileURLToPath(new URL('../../../assets/fonts/DejaVuSans-Bold.ttf', import.meta.url)),
};
const F = { regular: 'EnReglaSans', bold: 'EnReglaSans-Bold' } as const;
let glyphFont: fontkit.Font | null = null;
function hasGlyph(codePoint: number): boolean {
  glyphFont ??= fontkit.openSync(FONT_PATHS.regular);
  return glyphFont.hasGlyphForCodePoint(codePoint);
}
/** Texto listo para el PDF: sin recortes y con marcador para glifos no disponibles. */
export const pdfText = (value: string): string => sanitize(value, hasGlyph);

/**
 * Parte un texto en [lo que cabe en maxHeight con esa anchura, el resto]. Corta por palabras y,
 * si una sola palabra no cabe, por caracteres. Nunca descarta texto.
 */
export function splitToFit(doc: PDFKit.PDFDocument, text: string, width: number, maxHeight: number): [string, string] {
  if (doc.heightOfString(text, { width }) <= maxHeight) return [text, ''];
  const tokens = text.match(/\S+\s*|\s+/g) ?? [text];
  const fits = (n: number, src: string[]) => doc.heightOfString(src.slice(0, n).join(''), { width }) <= maxHeight;
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid, tokens)) lo = mid;
    else hi = mid - 1;
  }
  if (lo > 0) return [tokens.slice(0, lo).join('').trimEnd(), tokens.slice(lo).join('').trimStart()];
  // Ni la primera palabra cabe entera: se corta por caracteres.
  const chars = [...text];
  lo = 0;
  hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid, chars)) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return ['', text];
  return [chars.slice(0, lo).join(''), chars.slice(lo).join('')];
}

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

/** Cumplimiento de un día con tareas dadas por hechas gracias a correcciones hechas otro día (I-1). */
export interface DayNote {
  date: string;
  expected: number;
  done: number;
  /** Tareas del día cumplidas solo gracias a una corrección hecha en un día posterior. */
  correctedLater: number;
}

export interface PdfInput {
  appName: string;
  org: Organization;
  from: string;
  to: string;
  types: RecordType[];
  /** Iterador de registros por tipo (en lotes, para no cargarlo todo en memoria). */
  records: (type: RecordType) => AsyncIterable<ReportRecord[]>;
  maxRows: number;
  /** Días del periodo con `correctedLater > 0` (nota por día). */
  dayNotes?: DayNote[];
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
  doc.registerFont(F.regular, FONT_PATHS.regular);
  doc.registerFont(F.bold, FONT_PATHS.bold);
  const tz = input.org.timezone;
  const generatedAt = formatDateTimeEs(new Date(), tz);
  let pageNo = 1;

  const footer = () => {
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 32;
    doc
      .font(F.regular)
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
    doc.font(F.bold).fontSize(18).fillColor(COLOR.brand).text(pdfText('Registros de autocontrol de higiene alimentaria'), left, doc.y, { width });
    doc.moveDown(0.3);
    doc.font(F.bold).fontSize(13).fillColor(COLOR.text).text(pdfText(input.org.name), { width });
    doc
      .font(F.regular)
      .fontSize(10)
      .fillColor(COLOR.muted)
      .text(pdfText(`${BUSINESS_TYPE_LABELS[input.org.business_type as keyof typeof BUSINESS_TYPE_LABELS] ?? input.org.business_type} · ${timezoneLabel(tz)}`), { width })
      .text(pdfText(`Periodo: del ${formatDateEs(input.from)} al ${formatDateEs(input.to)}`), { width })
      .text(pdfText(`Tipos incluidos: ${input.types.map((t) => RECORD_TYPE_LABELS[t]).join(', ')}`), { width });
    doc.moveDown(0.4);
    doc
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text(
        pdfText(
          'Documento generado a partir de los registros introducidos por el establecimiento. Los registros no se pueden modificar ni borrar: las correcciones figuran a continuación del registro original, con cuándo, quién y por qué se corrigió. Las filas destacadas en rojo indican valores fuera de los límites configurados por el local.',
        ),
        { width },
      );
    doc.moveDown(0.8);

    // I-1: días cuyo cumplimiento mejoró por correcciones hechas en un día posterior.
    const notesWithLate = (input.dayNotes ?? []).filter((d) => d.correctedLater > 0);
    if (notesWithLate.length > 0) {
      doc.font(F.bold).fontSize(11).fillColor(COLOR.brand).text(pdfText('Cumplimiento completado con correcciones posteriores'), left, doc.y, { width });
      doc.moveDown(0.2);
      doc
        .font(F.regular)
        .fontSize(8)
        .fillColor(COLOR.muted)
        .text(
          pdfText(
            'En estos días, alguna tarea prevista figura como cumplida gracias a una corrección (enmienda) registrada en un día POSTERIOR al del hecho. Cada corrección figura en las tablas, junto al registro original, con su fecha real, autor y motivo.',
          ),
          { width },
        );
      doc.moveDown(0.2);
      for (const d of notesWithLate) {
        if (doc.y + 14 > bottomLimit()) doc.addPage();
        const pct = d.expected > 0 ? ` (cumplimiento del día: ${d.done} de ${d.expected})` : '';
        doc
          .font(F.regular)
          .fontSize(8.5)
          .fillColor(COLOR.text)
          .text(pdfText(`${formatDateEs(d.date)}: ${d.correctedLater} tarea(s) cumplida(s) mediante una corrección hecha en un día posterior${pct}.`), left, doc.y, { width });
      }
      doc.moveDown(0.8);
    }

    let totalRows = 0;
    for (const type of input.types) {
      const cols = COLUMNS[type];
      const totalWeight = cols.reduce((a, c) => a + c.weight, 0);
      const widths = cols.map((c) => (c.weight / totalWeight) * width);

      if (doc.y + 60 > bottomLimit()) doc.addPage();
      doc.font(F.bold).fontSize(12).fillColor(COLOR.brand).text(pdfText(RECORD_TYPE_LABELS[type]), left, doc.y, { width });
      doc.moveDown(0.3);

      const drawHeader = () => {
        doc.font(F.bold).fontSize(8);
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

      const PAD = 3;
      const fontFor = (i: number, n: number, o: { alert: boolean; amendment: boolean }) =>
        o.amendment && i === n - 1 ? F.regular : o.alert && i < 3 ? F.bold : F.regular;
      const cellHeight = (c: string, i: number, n: number, o: { alert: boolean; amendment: boolean }) => {
        doc.font(fontFor(i, n, o)).fontSize(8);
        return doc.heightOfString(c, { width: widths[i]! - 2 * PAD });
      };
      /**
       * Dibuja una fila completa. Si no cabe en lo que queda de página, las celdas se parten y
       * continúan en la siguiente (tras repetir la cabecera): ningún texto se recorta ni se solapa.
       */
      const drawRow = (cells: string[], o: { alert: boolean; amendment: boolean }) => {
        let remaining = cells;
        let fresh = false;
        for (let guard = 0; guard < 10_000; guard++) {
          const n = remaining.length;
          const needed = Math.max(...remaining.map((c, i) => cellHeight(c, i, n, o))) + 2 * PAD;
          const space = bottomLimit() - doc.y;
          let parts: string[];
          let rest: string[] | null = null;
          let h: number;
          if (needed <= space) {
            parts = remaining;
            h = needed;
          } else if (!fresh && (space < 40 || needed <= doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 40)) {
            // Cabe entera en una página nueva: se pasa de página en vez de partirla.
            doc.addPage();
            drawHeader();
            fresh = true;
            continue;
          } else {
            const split = remaining.map((c, i) => {
              doc.font(fontFor(i, n, o)).fontSize(8);
              return splitToFit(doc, c, widths[i]! - 2 * PAD, space - 2 * PAD);
            });
            parts = split.map((x) => x[0]);
            rest = split.map((x) => x[1]);
            h = space;
          }
          const y = doc.y;
          if (o.alert) doc.rect(left, y, width, h).fill(COLOR.alertBg);
          else if (o.amendment) doc.rect(left, y, width, h).fill(COLOR.amendBg);
          let x = left;
          parts.forEach((c, i) => {
            doc
              .font(fontFor(i, n, o))
              .fontSize(8)
              .fillColor(o.alert ? COLOR.alertText : o.amendment && i === n - 1 ? COLOR.muted : COLOR.text)
              .text(c, x + PAD, y + PAD, { width: widths[i]! - 2 * PAD });
            x += widths[i]!;
          });
          doc
            .moveTo(left, y + h)
            .lineTo(left + width, y + h)
            .lineWidth(0.4)
            .strokeColor(COLOR.border)
            .stroke();
          doc.y = y + h;
          if (!rest || rest.every((c) => c === '')) return;
          remaining = rest;
          doc.addPage();
          drawHeader();
          fresh = true;
        }
      };

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
          const isAmendment = r.amends_record_id != null || r.amended_by != null;
          drawRow(cells, { alert: r.alert, amendment: isAmendment });
          count += 1;
          totalRows += 1;
        }
        if (totalRows >= input.maxRows) break;
      }
      doc.x = left;
      if (count === 0) {
        doc.font(F.regular).fontSize(9).fillColor(COLOR.muted).text('Sin registros en el periodo.', left, doc.y + 4, { width });
      } else {
        doc.font(F.regular).fontSize(8).fillColor(COLOR.muted).text(`${count} registro(s).`, left, doc.y + 4, { width });
      }
      doc.moveDown(1.2);
      if (totalRows >= input.maxRows) {
        doc
          .font(F.bold)
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
