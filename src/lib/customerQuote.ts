import { jsPDF } from 'jspdf';
import type { SalesQuoteSnapshot } from '../types';
import { humanModality } from './salesFlow';

const INK: [number, number, number] = [25, 25, 23];
const MUTED: [number, number, number] = [108, 104, 98];
const LINE: [number, number, number] = [222, 218, 210];
const PAPER: [number, number, number] = [248, 247, 244];
const ACCENT: [number, number, number] = [143, 126, 106];
const WHITE: [number, number, number] = [255, 255, 255];

const money = (value: unknown) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Number(value || 0));

function cleanCommercialName(value: unknown) {
  const raw = String(value || 'Experiencia').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return raw
    .replace(/\s*[([]?\b(PRUEBA|TEST|DEMO|QA|DEV)\b[\])]?\s*$/i, '')
    .replace(/\b(PRUEBA|TEST|DEMO|QA|DEV)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Experiencia';
}

function commercialQuoteCode(value: string) {
  const match = value.match(/^(.*)-V(\d+)$/i);
  return match ? `${match[1]} · V${match[2]}` : value;
}

function parseDate(value: unknown) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const parsed = new Date(`${raw}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compactDate(value: unknown) {
  const parsed = parseDate(value);
  if (!parsed) return 'Por confirmar';
  return parsed.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace('.', '')
    .toUpperCase();
}

function longDate(value: unknown) {
  const parsed = parseDate(value);
  if (!parsed) return 'Por confirmar';
  return parsed.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
}

function timeText(value: unknown) {
  const raw = String(value || '').trim();
  return raw ? raw.slice(0, 5) : '';
}

function scheduleText(item: Record<string, unknown>) {
  const start = timeText(item.start_time);
  const end = timeText(item.end_time);
  if (start && end) return `${start}–${end}`;
  if (start) return start;
  const schedule = String(item.schedule || '').trim();
  const timeRange = schedule.match(/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\b/);
  return timeRange?.[0]?.replace(/\s+/g, '') || 'Por confirmar';
}

function pickupText(item: Record<string, unknown>) {
  const explicit = String(item.pickup_time || item.estimated_pickup_time || '').trim();
  return explicit ? explicit : 'Por confirmar';
}

function servicePeriod(items: Array<Record<string, unknown>>) {
  const dated = items
    .map(item => ({ raw: item.service_date, parsed: parseDate(item.service_date) }))
    .filter(row => row.parsed)
    .sort((a, b) => (a.parsed as Date).getTime() - (b.parsed as Date).getTime());
  if (!dated.length) return { start: 'Por confirmar', end: 'Por confirmar' };
  return { start: compactDate(dated[0].raw), end: compactDate(dated[dated.length - 1].raw) };
}

function modeExplanation(mode: string) {
  const lower = mode.toLowerCase();
  if (lower.includes('semi')) return 'Grupo reducido compartido, con una experiencia más personalizada.';
  if (lower.includes('private') || lower.includes('privado')) return 'Servicio dedicado exclusivamente al grupo de esta reserva.';
  if (lower.includes('regular')) return 'Servicio compartido con otros pasajeros.';
  if (lower.includes('fixed')) return 'Servicio dedicado con tarifa aplicada al servicio completo.';
  return 'Servicio configurado según las condiciones indicadas en esta propuesta.';
}

export function concisePolicy(summary?: string | null) {
  const source = String(summary || '');
  const special = /Alta Montaña|Uyuni/i.test(source)
    ? 'Los servicios especiales pueden tener condiciones particulares, informadas antes de confirmar.'
    : '';
  return [
    '+6 días antes: devolución 100%*',
    '5 días a más de 24 h: devolución 70%*',
    'Menos de 24 h / no-show: sin devolución',
    special,
  ].filter(Boolean);
}

type QuoteOptions = {
  hotelName?: string;
  clientName?: string;
  destination?: string;
  depositPct?: number;
};

function drawBrandHeader(doc: jsPDF, quoteCode: string, pageLabel?: string) {
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.text('LINK VENTAS', 18, 16);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.text('HOTEL EXPERIENCE', 18, 20.5);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text(pageLabel || 'COTIZACIÓN', 192, 16, { align: 'right' });
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.9); doc.text(commercialQuoteCode(quoteCode), 192, 20.5, { align: 'right' });
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(18, 27, 192, 27);
}

function drawSummaryCell(doc: jsPDF, x: number, y: number, label: string, value: string, width: number) {
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.2); doc.text(label.toUpperCase(), x, y);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.7);
  doc.text(doc.splitTextToSize(value, width), x, y + 5);
}

function rowHeight(doc: jsPDF, item: Record<string, unknown>) {
  const title = cleanCommercialName(item.product_name).toUpperCase();
  const lines = doc.splitTextToSize(title, 38);
  return Math.max(13, 8 + lines.length * 3.2);
}

function drawServiceTable(doc: jsPDF, items: Array<Record<string, unknown>>, y: number) {
  const left = 18;
  const right = 192;
  const columns = [
    { key: 'date', label: 'FECHA', width: 20 },
    { key: 'schedule', label: 'HORARIO', width: 24 },
    { key: 'pickup', label: 'PICKUP EST.', width: 25 },
    { key: 'service', label: 'EXPERIENCIA', width: 40 },
    { key: 'mode', label: 'MODALIDAD', width: 21 },
    { key: 'pax', label: 'PAX', width: 10 },
    { key: 'unit', label: 'UNIT.', width: 17 },
    { key: 'total', label: 'TOTAL', width: 17 },
  ];

  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
  doc.rect(left, y, right - left, 9, 'FD');
  let x = left;
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(4.8);
  columns.forEach(column => {
    const alignRight = column.key === 'unit' || column.key === 'total';
    doc.text(column.label, alignRight ? x + column.width - 1.5 : x + 1.5, y + 5.8, alignRight ? { align: 'right' } : undefined);
    x += column.width;
  });
  y += 9;

  items.forEach((item, index) => {
    const height = rowHeight(doc, item);
    if (index % 2 === 1) { doc.setFillColor(252, 251, 249); doc.rect(left, y, right - left, height, 'F'); }
    doc.setDrawColor(...LINE); doc.line(left, y + height, right, y + height);

    const values = [
      compactDate(item.service_date).replace(/\s\d{4}$/, ''),
      scheduleText(item),
      pickupText(item),
      cleanCommercialName(item.product_name).toUpperCase(),
      humanModality(String(item.modality || item.catalog_price_mode || '')),
      String(Math.max(1, Number(item.pax || 1))),
      money(item.unit_price),
      money(item.total_price),
    ];

    x = left;
    values.forEach((value, cellIndex) => {
      const column = columns[cellIndex];
      const isPrice = cellIndex >= 6;
      const isService = cellIndex === 3;
      doc.setTextColor(...INK);
      doc.setFont('helvetica', isService || isPrice ? 'bold' : 'normal');
      doc.setFontSize(isService ? 5.6 : isPrice ? 5.4 : 5.2);
      if (isService) {
        doc.text(doc.splitTextToSize(value, column.width - 3), x + 1.5, y + 5.2);
      } else if (isPrice) {
        doc.text(value, x + column.width - 1.5, y + 5.5, { align: 'right' });
      } else {
        doc.text(doc.splitTextToSize(value, column.width - 3), x + 1.5, y + 5.2);
      }
      x += column.width;
    });
    y += height;
  });

  return y;
}

function drawDetailPage(doc: jsPDF, quote: SalesQuoteSnapshot, items: Array<Record<string, unknown>>) {
  doc.addPage();
  drawBrandHeader(doc, quote.quote_code, 'DETALLE DE EXPERIENCIAS');
  let y = 38;

  items.forEach((item, index) => {
    const title = cleanCommercialName(item.product_name).toUpperCase();
    const description = String(item.description || '').trim() || modeExplanation(String(item.modality || item.catalog_price_mode || ''));
    const mode = humanModality(String(item.modality || item.catalog_price_mode || ''));
    const itemPax = Math.max(1, Number(item.pax || 1));
    const body = doc.splitTextToSize(description, 135);
    const needed = Math.max(32, 25 + body.length * 3.5);

    if (y + needed > 262) {
      doc.addPage(); drawBrandHeader(doc, quote.quote_code, 'DETALLE DE EXPERIENCIAS'); y = 38;
    }

    doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
    doc.roundedRect(18, y, 174, needed, 3, 3, 'FD');
    doc.setTextColor(...ACCENT); doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.text(String(index + 1).padStart(2, '0'), 24, y + 8);
    doc.setTextColor(...INK); doc.setFontSize(10.5); doc.text(doc.splitTextToSize(title, 112), 36, y + 8);
    doc.setFontSize(10); doc.text(money(item.total_price), 186, y + 8, { align: 'right' });
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4);
    doc.text(`${longDate(item.service_date)} · ${scheduleText(item)} · ${mode} · ${itemPax} pax`, 36, y + 16);
    doc.setFontSize(6.6); doc.text(body, 36, y + 23);
    y += needed + 7;
  });

  if (y > 220) { doc.addPage(); drawBrandHeader(doc, quote.quote_code, 'CONDICIONES'); y = 38; }
  else y += 5;

  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('CONDICIONES PRINCIPALES', 18, y); y += 7;
  concisePolicy(quote.policy_summary).slice(0, 3).forEach(line => {
    doc.setFillColor(...ACCENT); doc.circle(19.5, y - 1.1, 0.75, 'F');
    doc.setTextColor(...INK); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.text(line, 23, y); y += 5;
  });
  doc.setTextColor(...MUTED); doc.setFontSize(5.9);
  doc.text('* Descontando entradas, permisos o servicios de terceros ya emitidos y no reembolsables.', 18, y + 1); y += 7;
  doc.text('Las condiciones completas aplicables a la reserva prevalecen sobre este resumen.', 18, y);
}

export function buildCustomerQuotePdf(quote: SalesQuoteSnapshot, options?: QuoteOptions) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const left = 18;
  const right = 192;
  const lead = (quote.snapshot?.lead || {}) as Record<string, unknown>;
  const items = ((quote.snapshot?.items || []) as Array<Record<string, unknown>>)
    .slice()
    .sort((a, b) => `${String(a.service_date || '')}|${String(a.start_time || '')}`.localeCompare(`${String(b.service_date || '')}|${String(b.start_time || '')}`));
  const reference = String(lead.reference || lead.code || '').trim();
  const client = String(options?.clientName || '').trim() || 'Pasajero por confirmar';
  const hotel = String(options?.hotelName || '').trim() || 'Por confirmar';
  const pax = Math.max(1, Number(lead.pax || 1));
  const period = servicePeriod(items);

  drawBrandHeader(doc, quote.quote_code);
  let y = 40;

  doc.setTextColor(...ACCENT); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8); doc.text('PROPUESTA PARA', left, y);
  y += 7;
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text(doc.splitTextToSize(client, 130), left, y);
  y += 10;

  doc.setFillColor(...PAPER); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
  doc.roundedRect(left, y, right - left, 29, 3, 3, 'FD');
  drawSummaryCell(doc, left + 6, y + 7, 'Inicio servicios', period.start, 35);
  drawSummaryCell(doc, left + 49, y + 7, 'Término servicios', period.end, 35);
  drawSummaryCell(doc, left + 92, y + 7, 'Pasajeros', `${pax} ${pax === 1 ? 'pasajero' : 'pasajeros'}`, 25);
  drawSummaryCell(doc, left + 125, y + 7, 'Hotel / origen', hotel, 43);
  y += 36;

  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text('SERVICIOS COTIZADOS', left, y);
  if (reference) {
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.7); doc.text(`Ref. ${reference}`, right, y, { align: 'right' });
  }
  y += 7;

  y = drawServiceTable(doc, items, y);
  y += 8;

  doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(left, y, right, y); y += 9;
  const totalPerPax = pax > 0 ? Number(quote.total || 0) / pax : Number(quote.total || 0);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.8); doc.text(`TOTAL / PAX (${pax})`, left, y);
  doc.setTextColor(...INK); doc.setFontSize(8.5); doc.text(money(totalPerPax), left + 53, y);
  doc.setTextColor(...MUTED); doc.setFontSize(6); doc.text('TOTAL DE LA EXPERIENCIA', right - 66, y);
  doc.setTextColor(...INK); doc.setFontSize(18); doc.text(money(quote.total), right, y + 2, { align: 'right' });
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.text('CLP', right, y + 8, { align: 'right' });
  y += 17;

  const depositPct = Number(options?.depositPct || 0);
  if (depositPct > 0 && depositPct < 100) {
    const deposit = Number(quote.total || 0) * (depositPct / 100);
    const balance = Number(quote.total || 0) - deposit;
    doc.setFillColor(...PAPER); doc.roundedRect(left, y, right - left, 16, 2.5, 2.5, 'F');
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.text(`Reserva ${depositPct}%`, left + 6, y + 6.5);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(money(deposit), left + 61, y + 6.5, { align: 'right' });
    doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.text('Saldo restante', left + 102, y + 6.5);
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(money(balance), right - 6, y + 6.5, { align: 'right' });
    y += 22;
  }

  doc.setFillColor(251, 250, 247); doc.setDrawColor(...LINE); doc.roundedRect(left, y, right - left, 16, 2, 2, 'FD');
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.1);
  doc.text(doc.splitTextToSize('Los horarios marcados como “Por confirmar” se actualizarán cuando la coordinación del servicio quede definida.', 162), left + 6, y + 6.5);

  doc.setDrawColor(...LINE); doc.line(left, 276, right, 276);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); doc.text('LINK · HOTEL EXPERIENCE', left, 282);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.2); doc.text('Cotización comercial · valores expresados en pesos chilenos', right, 282, { align: 'right' });

  drawDetailPage(doc, quote, items);

  const fileName = `${quote.quote_code}.pdf`;
  return { doc, fileName };
}

export function downloadCustomerQuote(quote: SalesQuoteSnapshot, options?: QuoteOptions) {
  const { doc, fileName } = buildCustomerQuotePdf(quote, options);
  doc.save(fileName);
  return fileName;
}

export async function shareCustomerQuote(quote: SalesQuoteSnapshot, options?: QuoteOptions) {
  const { doc, fileName } = buildCustomerQuotePdf(quote, options);
  const blob = doc.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({ title: `Cotización ${quote.quote_code}`, text: 'Cotización LINK Ventas', files: [file] });
    return 'shared' as const;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded' as const;
}
