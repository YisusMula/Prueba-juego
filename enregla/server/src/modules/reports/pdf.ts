import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import * as fontkit from 'fontkit';
import type { Organization } from '../../db/types.js';
import { RECORD_TYPE_LABELS, BUSINESS_TYPE_LABELS, type RecordType, timezoneLabel, fullAddress } from '../../schemas/index.js';
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
  partialBg: '#ffedd5',
  partialText: '#9a3412',
  border: '#cbd2d9',
};

/**
 * Nota sobre la conservación de los registros (1.8). Describe con exactitud lo que hace la
 * aplicación, sin prometer más: no hay forma de modificar ni borrar un registro desde ella, las
 * correcciones son registros nuevos con autor, fecha y motivo, y eliminar el local borra sus
 * registros pasado el plazo de conservación.
 */
export function pdfIntegrityNote(graceDays = 30): string {
  return (
    'Documento generado a partir de los registros introducidos por el establecimiento. ' +
    'La aplicación no permite modificar ni borrar registros: cada corrección se guarda como un registro nuevo, ' +
    'a continuación del original, con su autor, fecha y motivo. ' +
    `Si el establecimiento elimina el local en la aplicación, sus registros se conservan ${graceDays} días (durante los que puede restaurarlo) y después se borran definitivamente; ` +
    'su titular también puede pedir su eliminación inmediata tras marcarlo para eliminación, y entonces se eliminará en la próxima hora. ' +
    'Las filas destacadas en rojo indican valores fuera de los límites configurados por el local; en naranja, las limpiezas parciales; en amarillo, los registros corregidos y sus correcciones.'
  );
}
export const PDF_INTEGRITY_NOTE = pdfIntegrityNote(30);

/** Filas entre cesiones del event loop (cada fila cuesta ~1 ms de CPU). */
const YIELD_EVERY_ROWS = 20;
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));
/** Tope de líneas de «Tareas sin registrar» (un año con muchas tareas). */
export const MAX_MISSING_ROWS = 3000;

/** Cumplimiento de un día con tareas dadas por hechas gracias a correcciones hechas otro día (I-1). */
export interface DayNote {
  date: string;
  expected: number;
  done: number;
  /** Tareas del día cumplidas solo gracias a una corrección hecha en un día posterior. */
  correctedLater: number;
}

export interface PdfEstablishment {
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  sanitaryRegistry: string | null;
  sanitaryRegistryFormatOk?: boolean;
}

export interface PdfMissingItem {
  kind: 'temperatura' | 'limpieza' | 'personalizado';
  name: string;
  expected: number;
  done: number;
  partial?: boolean;
  frequency: string;
}

export interface PdfSummary {
  compliancePercent: number | null;
  expected: number;
  done: number;
  alerts: number;
  alertsWithAction: number;
  openIncidents: number;
  daysWithGaps: number;
  daysEvaluated: number;
  missingDays: { date: string; items: PdfMissingItem[] }[];
}

export interface PdfVerification {
  from: string;
  to: string;
  kind: string;
  comment: string | null;
  userName: string;
  userRole: string;
  createdAt: string;
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
  /** Días que se conserva un local pendiente de eliminación (ORG_DELETION_GRACE_DAYS). */
  deletionGraceDays?: number;
  /** Quién descargó el informe y cuándo (portada). */
  generatedBy?: string;
  generatedAt?: string;
  establishment?: PdfEstablishment;
  summary?: PdfSummary;
  verifications?: PdfVerification[];
  /** Fecha local de hoy (la del día de hoy en «Tareas sin registrar» aún no ha terminado). */
  today?: string;
}

const ROLE_LABEL: Record<string, string> = { owner: 'propietario/a', manager: 'encargado/a' };

/** «Verificado por Laura Gil (encargado/a) el 03/11/2026 a las 10:15 · semana del 27/10/2026 al 02/11/2026». */
export function verificationLine(v: PdfVerification, tz: string, period?: { from: string; to: string }): string {
  const when = formatDateTimeEs(new Date(v.createdAt), tz);
  const what = v.kind === 'week' ? 'semana' : v.kind === 'month' ? 'mes' : 'periodo';
  const covers = period ? (v.from <= period.from && v.to >= period.to ? ' (cubre todo el periodo del informe)' : ' (cubre parte del periodo del informe)') : '';
  const comment = v.comment ? ` · Comentario: «${v.comment}»` : '';
  return `Verificado por ${v.userName} (${ROLE_LABEL[v.userRole] ?? v.userRole}) el ${when} · ${what} del ${formatDateEs(v.from)} al ${formatDateEs(v.to)}${covers}${comment}`;
}

/** Texto de una tarea sin registrar (sección «Tareas sin registrar»). */
export function missingText(m: PdfMissingItem): [string, string] {
  const kind = m.kind === 'temperatura' ? 'Temperatura' : m.kind === 'limpieza' ? 'Limpieza' : 'Registro';
  const period = m.frequency === 'weekly' ? ' (semanal: no consta en toda la semana)' : m.frequency === 'monthly' ? ' (mensual: no consta en todo el mes)' : '';
  const what =
    m.kind === 'limpieza'
      ? m.partial
        ? `Solo limpieza parcial: falta completarla${period}`
        : `Sin registrar${period}`
      : m.expected > 1
        ? m.done > 0
          ? `${m.done} de ${m.expected} ${m.kind === 'temperatura' ? 'controles' : 'veces'}`
          : `Sin registrar (0 de ${m.expected} ${m.kind === 'temperatura' ? 'controles' : 'veces'})`
        : `Sin registrar${period}`;
  return [`${kind}: ${m.name}`, what];
}

/** Clave de agrupación de un registro dentro de su tipo (equipo, plan o plantilla). */
function groupKeyOf(type: RecordType, r: ReportRecord): string | null {
  if (type === 'temperatura') return r.equipment_id ?? '—';
  if (type === 'limpieza') return r.cleaning_plan_id ?? '—';
  if (type === 'personalizado') return r.custom_template_id ?? '—';
  return null;
}

const num = (v: unknown) => (typeof v === 'number' ? String(v).replace('.', ',').replace('-', '−') : '');
function rangeText(min: unknown, max: unknown, unit = '°C'): string {
  const a = typeof min === 'number' ? num(min) : null;
  const b = typeof max === 'number' ? num(max) : null;
  if (a && b) return `de ${a} a ${b} ${unit}`;
  if (b) return `máx. ${b} ${unit}`;
  if (a) return `mín. ${a} ${unit}`;
  return 'sin límites configurados';
}

/** Título y subtítulo de un grupo (equipo y su rango, plan, registro personalizado). */
function groupTitle(type: RecordType, rows: ReportRecord[]): { title: string; subtitle: string } {
  const last = rows[rows.length - 1]!.data;
  if (type === 'temperatura') {
    const ranges = [...new Set(rows.map((r) => rangeText(r.data.minTemp, r.data.maxTemp)))];
    return { title: String(last.equipmentName ?? '—'), subtitle: `Rango configurado: ${ranges.join('; ')}${ranges.length > 1 ? ' (cambió durante el periodo)' : ''} · ${rows.length} registro(s)` };
  }
  if (type === 'limpieza') {
    const items = (last.items as unknown[] | undefined)?.length ?? 0;
    const partial = rows.filter((r) => r.data.completed !== true && !r.amended_by).length;
    return { title: String(last.planName ?? '—'), subtitle: `${items} zona(s) · ${rows.length} registro(s)${partial ? ` · ${partial} parcial(es)` : ''}` };
  }
  const kind = last.kind === 'checklist' ? 'Lista de comprobación' : last.kind === 'numeric' ? `Valor (${rangeText(last.min, last.max, String(last.unit ?? '')).trim()})` : 'Sí / No';
  return { title: String(last.templateName ?? '—'), subtitle: `${kind} · ${rows.length} registro(s)` };
}

/**
 * Genera el informe y lo escribe en el documento, que es un stream legible.
 * La función devuelve el documento inmediatamente; el contenido se va
 * escribiendo de forma asíncrona y `doc.end()` se llama al terminar.
 * Las páginas se guardan en memoria (`bufferPages`) para numerarlas «Página X de Y» al final; el tamaño
 * sigue acotado por el máximo de filas y el tope de bytes del llamador.
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
    bufferPages: true,
  });
  doc.registerFont(F.regular, FONT_PATHS.regular);
  doc.registerFont(F.bold, FONT_PATHS.bold);
  const tz = input.org.timezone;
  const generatedAt = formatDateTimeEs(input.generatedAt ? new Date(input.generatedAt) : new Date(), tz);

  /** Pie de cada página: se dibuja al final, cuando ya se sabe cuántas páginas hay. */
  const footer = (page: number, total: number) => {
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 32;
    // El texto nunca se recorta: con un nombre muy largo el pie ocupa dos líneas (sube lo necesario).
    const text = pdfText(`${input.org.name} · Generado el ${generatedAt}${input.generatedBy ? ` por ${input.generatedBy}` : ''} con ${input.appName}`);
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right - 110;
    doc.font(F.regular).fontSize(7.5).fillColor(COLOR.muted);
    const h = doc.heightOfString(text, { width: w });
    doc
      .text(text, doc.page.margins.left, Math.min(y, doc.page.height - 22 - h), { width: w })
      .text(`Página ${page} de ${total}`, doc.page.width - doc.page.margins.right - 110, y, { width: 110, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  };
  doc.on('pageAdded', () => {
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h: number) => {
    if (doc.y + h > bottomLimit()) doc.addPage();
  };
  const sectionTitle = (t: string, size = 12) => {
    ensure(50);
    doc.font(F.bold).fontSize(size).fillColor(COLOR.brand).text(pdfText(t), left, doc.y, { width });
    doc.moveDown(0.3);
  };

  /** Pares «etiqueta: valor» en dos columnas (portada). */
  const keyValues = (rows: [string, string | null, string?][]) => {
    const labelW = 230;
    for (const [label, value, hint] of rows) {
      const v = value ?? 'No indicado';
      doc.font(F.regular).fontSize(9.5);
      const h = Math.max(doc.heightOfString(pdfText(label), { width: labelW - 8 }), doc.heightOfString(pdfText(v), { width: width - labelW })) + (hint ? 11 : 0) + 4;
      ensure(h);
      const y = doc.y;
      doc.fillColor(COLOR.muted).text(pdfText(label), left, y, { width: labelW - 8 });
      doc.font(value ? F.bold : F.regular).fillColor(value ? COLOR.text : COLOR.muted).text(pdfText(v), left + labelW, y, { width: width - labelW });
      if (hint) doc.font(F.regular).fontSize(7.5).fillColor(COLOR.muted).text(pdfText(hint), left + labelW, doc.y, { width: width - labelW });
      doc.y = Math.max(doc.y, y + h - 2);
    }
    doc.x = left;
  };

  async function render(): Promise<void> {
    doc.y = doc.page.margins.top;
    // --- Portada ---------------------------------------------------------------------------------
    doc.font(F.bold).fontSize(18).fillColor(COLOR.brand).text(pdfText('Registros de autocontrol de higiene alimentaria'), left, doc.y, { width });
    doc.moveDown(0.3);
    doc.font(F.bold).fontSize(15).fillColor(COLOR.text).text(pdfText(input.org.name), { width });
    doc
      .font(F.regular)
      .fontSize(10)
      .fillColor(COLOR.muted)
      .text(pdfText(`${BUSINESS_TYPE_LABELS[input.org.business_type as keyof typeof BUSINESS_TYPE_LABELS] ?? input.org.business_type} · ${timezoneLabel(tz)}`), { width });
    doc.moveDown(0.6);
    const e = input.establishment;
    const address = e ? fullAddress(e) : '';
    keyValues([
      ['Nombre comercial', input.org.name],
      ['Razón social', e?.legalName ?? null],
      ['NIF / CIF', e?.taxId ?? null],
      ['Dirección', address || null],
      [
        'Nº de Registro Sanitario (RGSEAA) o autorización sanitaria',
        e?.sanitaryRegistry ?? null,
        e?.sanitaryRegistry && e.sanitaryRegistryFormatOk === false ? 'No sigue el formato habitual del RGSEAA (NN.NNNNN/XX): puede ser una autorización autonómica.' : undefined,
      ],
      ['Periodo', `Del ${formatDateEs(input.from)} al ${formatDateEs(input.to)}`],
      ['Tipos incluidos', input.types.map((t) => RECORD_TYPE_LABELS[t]).join(', ')],
      ['Generado', `El ${generatedAt}${input.generatedBy ? ` por ${input.generatedBy}` : ''}, con ${input.appName}`],
    ]);
    doc.moveDown(0.6);

    // --- Resumen del periodo -----------------------------------------------------------------------
    const sm = input.summary;
    if (sm) {
      sectionTitle('Resumen del periodo');
      doc.font(F.regular).fontSize(8).fillColor(COLOR.muted).text(pdfText('Sobre todos los registros del periodo (aunque el informe incluya solo algunos tipos). El cumplimiento se calcula igual que en la aplicación, con la configuración vigente cada día.'), left, doc.y, { width });
      doc.moveDown(0.3);
      const pct = sm.compliancePercent == null ? 'Sin tareas previstas en el periodo' : `${sm.compliancePercent} % (${sm.done} de ${sm.expected} tareas previstas)`;
      const withoutAction = sm.alerts - sm.alertsWithAction;
      keyValues([
        ['Cumplimiento de las tareas previstas', pct],
        [
          'Alertas (fuera de límite, rechazos o indicios)',
          sm.alerts === 0
            ? 'Ninguna'
            : withoutAction === 0
              ? `${sm.alerts}, ${sm.alerts === 1 ? 'con acción correctora' : 'todas con acción correctora'}`
              : `${sm.alerts}: ${sm.alertsWithAction} con acción correctora y ${withoutAction} sin acción indicada`,
        ],
        ['Incidencias del periodo que siguen abiertas', String(sm.openIncidents)],
        [
          'Días con tareas sin registrar',
          sm.daysWithGaps === 0 ? `Ninguno (de ${sm.daysEvaluated} día(s) evaluados)` : `${sm.daysWithGaps} de ${sm.daysEvaluated} día(s) evaluados (detalle en «Tareas sin registrar», al final)`,
        ],
      ]);
      doc.moveDown(0.4);
    }
    // --- Verificación del responsable --------------------------------------------------------------
    if (input.verifications) {
      sectionTitle('Verificación del responsable', 11);
      if (input.verifications.length === 0) {
        doc.font(F.regular).fontSize(9).fillColor(COLOR.muted).text(pdfText('Ningún responsable ha marcado como revisado este periodo en la aplicación. Puede firmarse a mano en el espacio del final.'), left, doc.y, { width });
      } else {
        for (const v of input.verifications) {
          ensure(14);
          doc.font(F.regular).fontSize(9).fillColor(COLOR.text).text(pdfText(`• ${verificationLine(v, tz, { from: input.from, to: input.to })}`), left, doc.y, { width });
        }
      }
      doc.moveDown(0.6);
    }
    ensure(40);
    doc.font(F.regular).fontSize(8).fillColor(COLOR.muted).text(pdfText(pdfIntegrityNote(input.deletionGraceDays ?? 30)), left, doc.y, { width });
    doc.moveDown(0.8);

    // I-1: días cuyo cumplimiento mejoró por correcciones hechas en un día posterior.
    const notesWithLate = (input.dayNotes ?? []).filter((d) => d.correctedLater > 0);
    if (notesWithLate.length > 0) {
      sectionTitle('Cumplimiento completado con correcciones posteriores', 11);
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
        ensure(14);
        const pct = d.expected > 0 ? ` (cumplimiento del día: ${d.done} de ${d.expected})` : '';
        doc
          .font(F.regular)
          .fontSize(8.5)
          .fillColor(COLOR.text)
          .text(pdfText(`${formatDateEs(d.date)}: ${d.correctedLater} tarea(s) cumplida(s) mediante una corrección hecha en un día posterior${pct}.`), left, doc.y, { width });
      }
      doc.moveDown(0.8);
    }

    // La portada (datos, resumen y verificación) va sola en la primera página; las tablas, después.
    if (input.summary && input.types.length > 0) doc.addPage();

    // --- Tablas ---------------------------------------------------------------------------------------
    const PAD = 3;
    type RowStyle = { alert: boolean; amendment: boolean; partial: boolean };
    let totalRows = 0;
    let truncated = false;

    /** Tabla con cabecera repetida en cada página y filas que nunca se recortan. */
    function table(cols: { header: string; weight: number }[], continuation: () => string | null) {
      const totalWeight = cols.reduce((a, c) => a + c.weight, 0);
      const widths = cols.map((c) => (c.weight / totalWeight) * width);
      const drawHeader = () => {
        const cont = continuation();
        if (cont) doc.font(F.bold).fontSize(8.5).fillColor(COLOR.muted).text(pdfText(cont), left, doc.y, { width });
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
      const fontFor = (i: number, n: number, o: RowStyle) => (o.amendment && i === n - 1 ? F.regular : (o.alert && i < 3) || (o.partial && i === 2) ? F.bold : F.regular);
      const cellHeight = (c: string, i: number, n: number, o: RowStyle) => {
        doc.font(fontFor(i, n, o)).fontSize(8);
        return doc.heightOfString(c, { width: widths[i]! - 2 * PAD });
      };
      /**
       * Dibuja una fila completa. Si no cabe en lo que queda de página, las celdas se parten y
       * continúan en la siguiente (tras repetir la cabecera): ningún texto se recorta ni se solapa.
       */
      const drawRow = (cells: string[], o: RowStyle) => {
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
          } else if (!fresh && (space < 40 || needed <= doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 60)) {
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
          else if (o.partial) doc.rect(left, y, width, h).fill(COLOR.partialBg);
          else if (o.amendment) doc.rect(left, y, width, h).fill(COLOR.amendBg);
          let x = left;
          parts.forEach((c, i) => {
            doc
              .font(fontFor(i, n, o))
              .fontSize(8)
              .fillColor(o.alert ? COLOR.alertText : o.partial && i === 2 ? COLOR.partialText : o.amendment && i === n - 1 ? COLOR.muted : COLOR.text)
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
      return { drawHeader, drawRow };
    }

    for (const type of input.types) {
      if (truncated) break;
      const cols = COLUMNS[type];
      sectionTitle(RECORD_TYPE_LABELS[type]);

      // Registros del tipo (ya acotados a maxRows por el llamador) y, si procede, agrupados por
      // equipo, plan o registro personalizado; cada corrección va en el grupo de su original.
      const all: ReportRecord[] = [];
      for await (const batch of input.records(type)) all.push(...batch);
      const groups = new Map<string, ReportRecord[]>();
      const groupOfId = new Map<string, string>();
      for (const r of all) {
        const own = groupKeyOf(type, r);
        const key = own === null ? '' : (r.amends_record_id && groupOfId.get(r.amends_record_id)) || own;
        groupOfId.set(r.id, key);
        const list = groups.get(key);
        if (list) list.push(r);
        else groups.set(key, [r]);
      }
      const ordered = [...groups.entries()].map(([key, rows]) => ({ key, rows, ...(key === '' ? { title: '', subtitle: '' } : groupTitle(type, rows)) }));
      ordered.sort((a, b) => a.title.localeCompare(b.title, 'es'));

      let count = 0;
      for (const g of ordered) {
        if (truncated) break;
        if (g.key !== '') {
          ensure(70);
          doc.font(F.bold).fontSize(10).fillColor(COLOR.text).text(pdfText(g.title), left, doc.y, { width });
          doc.font(F.regular).fontSize(8).fillColor(COLOR.muted).text(pdfText(g.subtitle), left, doc.y, { width });
          doc.moveDown(0.2);
        } else ensure(50);
        const t = table(cols, () => (g.key !== '' ? `${RECORD_TYPE_LABELS[type]} · ${g.title} (continuación)` : `${RECORD_TYPE_LABELS[type]} (continuación)`));
        // La primera cabecera va sin la línea de «continuación» (que sí llevan las de páginas siguientes).
        table(cols, () => null).drawHeader();
        for (const r of g.rows) {
          if (totalRows >= input.maxRows) {
            truncated = true;
            break;
          }
          // Cede el event loop cada pocas filas: el resto de peticiones (y /healthz) siguen respondiendo.
          if (totalRows % YIELD_EVERY_ROWS === 0) {
            await yieldToEventLoop();
            if (doc.destroyed) return; // descarga cancelada: se deja de trabajar
          }
          const cells = formatRow(type, r, tz).map((c) => pdfText(c || '—'));
          const isAmendment = r.amends_record_id != null || r.amended_by != null;
          const partial = type === 'limpieza' && r.data.completed !== true;
          t.drawRow(cells, { alert: r.alert, amendment: isAmendment, partial });
          count += 1;
          totalRows += 1;
        }
        doc.moveDown(0.6);
      }
      doc.x = left;
      if (count === 0) {
        doc.font(F.regular).fontSize(9).fillColor(COLOR.muted).text('Sin registros en el periodo.', left, doc.y + 4, { width });
      } else {
        doc.font(F.regular).fontSize(8).fillColor(COLOR.muted).text(`${count} registro(s).`, left, doc.y, { width });
      }
      doc.moveDown(1.2);
      if (truncated) {
        doc
          .font(F.bold)
          .fontSize(9)
          .fillColor(COLOR.alertText)
          .text(pdfText(`Informe truncado: se ha alcanzado el máximo de ${input.maxRows} filas. Reduce el periodo o los tipos seleccionados.`), left, doc.y, { width });
      }
    }

    // --- Tareas sin registrar ----------------------------------------------------------------------
    if (sm) {
      sectionTitle('Tareas sin registrar');
      doc
        .font(F.regular)
        .fontSize(8)
        .fillColor(COLOR.muted)
        .text(
          pdfText(
            'Días y tareas exigibles según la configuración vigente ese día (equipos con controles diarios, planes de limpieza y registros personalizados con frecuencia) de los que no consta el registro, o consta incompleto. Una limpieza parcial no cuenta como hecha. El día de alta, reactivación o desactivación de un equipo, plan o registro no es exigible.',
          ),
          left,
          doc.y,
          { width },
        );
      doc.moveDown(0.3);
      if (sm.missingDays.length === 0) {
        doc.font(F.regular).fontSize(9).fillColor(COLOR.text).text('No falta ninguna tarea exigible en el periodo.', left, doc.y, { width });
      } else {
        const cols = [
          { header: 'Día', weight: 1 },
          { header: 'Tarea', weight: 2.6 },
          { header: 'Qué falta', weight: 2.4 },
        ];
        const t = table(cols, () => 'Tareas sin registrar (continuación)');
        table(cols, () => null).drawHeader();
        let n = 0;
        const totalItems = sm.missingDays.reduce((a, d) => a + d.items.length, 0);
        outer: for (const d of sm.missingDays) {
          for (const m of d.items) {
            if (n >= MAX_MISSING_ROWS) break outer;
            if (n % YIELD_EVERY_ROWS === 0) {
              await yieldToEventLoop();
              if (doc.destroyed) return;
            }
            const [task, what] = missingText(m);
            const day = `${formatDateEs(d.date)}${d.date === input.today ? ' (hoy: el día aún no ha terminado)' : ''}`;
            t.drawRow([pdfText(day), pdfText(task), pdfText(what)], { alert: false, amendment: false, partial: m.partial === true });
            n += 1;
          }
        }
        if (totalItems > n) {
          doc.font(F.bold).fontSize(9).fillColor(COLOR.alertText).text(pdfText(`Y ${totalItems - n} tarea(s) más sin registrar: consúltalas en Informes, en la aplicación, o acota el periodo.`), left, doc.y + 4, { width });
        }
      }
      doc.moveDown(1.2);
    }

    // --- Firma del responsable -----------------------------------------------------------------------
    if (sm) {
      if (doc.y + 150 > bottomLimit()) doc.addPage();
      sectionTitle('Revisión y firma del responsable');
      doc.font(F.regular).fontSize(8.5).fillColor(COLOR.muted).text(pdfText('Espacio para que el responsable del autocontrol firme a mano la revisión de estos registros.'), left, doc.y, { width });
      doc.moveDown(0.6);
      const y0 = doc.y;
      const boxH = 110;
      doc.rect(left, y0, width, boxH).lineWidth(0.8).strokeColor(COLOR.border).stroke();
      const col = width / 2;
      const line = (label: string, x: number, y: number, w: number) => {
        doc.font(F.regular).fontSize(9).fillColor(COLOR.text).text(pdfText(label), x, y, { width: 90, lineBreak: false });
        doc
          .moveTo(x + 90, y + 11)
          .lineTo(x + w - 16, y + 11)
          .lineWidth(0.5)
          .strokeColor(COLOR.muted)
          .stroke();
      };
      line('Nombre:', left + 12, y0 + 14, col);
      line('Cargo:', left + 12, y0 + 44, col);
      line('Fecha:', left + 12, y0 + 74, col);
      doc.font(F.regular).fontSize(9).fillColor(COLOR.text).text('Firma:', left + col + 12, y0 + 14, { width: 90, lineBreak: false });
      doc.y = y0 + boxH + 10;
      doc.x = left;
    }

    // --- «Página X de Y» en todas las páginas ----------------------------------------------------------
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      footer(i - range.start + 1, range.count);
    }
    doc.end();
  }

  render().catch((err: unknown) => {
    onError(err);
    doc.destroy(err instanceof Error ? err : new Error('Error generando el PDF'));
  });
  return doc;
}
