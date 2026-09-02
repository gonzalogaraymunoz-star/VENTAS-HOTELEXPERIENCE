import { jsPDF } from 'jspdf';
import type { SalesQuoteSnapshot } from '../types';
import { humanModality } from './salesFlow';

const money = (value: unknown) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Number(value || 0));

const date = (value: unknown) => {
  if (!value) return 'Por confirmar';
  const raw = String(value);
  const parsed = new Date(`${raw.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString('es-CL');
};

function tierLines(item: Record<string, unknown>) {
  const mode = String(item.catalog_price_mode || item.modality || '');
  const prices = (item.catalog_prices || {}) as Record<string, unknown>;
  if (mode.includes('private')) {
    const keys = Object.keys(prices).filter(key => /^\d+$/.test(key) && Number(prices[key]) > 0).sort((a, b) => Number(a) - Number(b));
    return keys.map(key => `${key} pax: ${money(prices[key])} por persona`);
  }
  if (mode.includes('regular')) return [`Tarifa regular: ${money(item.unit_price)} por persona`];
  if (mode.includes('fixed')) return [`Tarifa por servicio: ${money(item.total_price)}`];
  return [`Tarifa aplicada: ${money(item.unit_price)} por persona`];
}

function modeExplanation(mode: string) {
  const lower = mode.toLowerCase();
  if (lower.includes('semi')) return 'Semi privado: grupo reducido compartido, con menor cantidad de pasajeros que un servicio regular.';
  if (lower.includes('private') || lower.includes('privado')) return 'Privado: servicio dedicado al grupo de la reserva; la tarifa puede variar según la cantidad de pasajeros.';
  if (lower.includes('regular')) return 'Regular: servicio compartido con otros pasajeros; la tarifa se expresa por persona.';
  return 'Modalidad personalizada: las condiciones se aplican según el servicio indicado en esta cotización.';
}

export function concisePolicy(summary?: string | null) {
  const source = String(summary || '');
  const special = /Alta Montaña|Uyuni/i.test(source)
    ? 'Servicios especiales informados: pueden tener condiciones distintas y se indicarán cuando corresponda.'
    : '';
  return [
    '6 días o más antes del servicio: devolución 100%, descontando entradas, permisos o terceros ya emitidos y no reembolsables.',
    'Entre 5 días y más de 24 horas: devolución 70%.',
    'Menos de 24 horas o no-show: no corresponde devolución.',
    'Clima o cierre: primero se intenta reprogramar; si no es posible, se propone una alternativa equivalente.',
    'Devoluciones aprobadas: plazo máximo de procesamiento de 10 días.',
    special,
  ].filter(Boolean);
}

function ensureSpace(doc: jsPDF, y: number, needed = 18) {
  if (y + needed <= 278) return y;
  doc.addPage();
  return 18;
}

export function buildCustomerQuotePdf(quote: SalesQuoteSnapshot, options?: { hotelName?: string; clientName?: string }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const right = 192;
  const lead = (quote.snapshot?.lead || {}) as Record<string, unknown>;
  const items = (quote.snapshot?.items || []) as Array<Record<string, unknown>>;
  let y = 18;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('LINK VENTAS', 18, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text('HOTEL EXPERIENCE', 18, y + 5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('COTIZACIÓN', right, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(quote.quote_code, right, y + 5, { align: 'right' });
  y += 16; doc.setLineWidth(0.4); doc.line(18, y, right, y); y += 9;

  const reference = String(lead.reference || lead.code || 'Por definir');
  const client = options?.clientName || reference;
  const meta = [
    ['Referencia', reference],
    ['Cliente', client],
    ['Pax', String(lead.pax || '—')],
    ['Hotel / origen', options?.hotelName || 'Por definir'],
    ['Arribo', date(lead.checkin)],
    ['Salida', date(lead.checkout)],
  ];
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal');
  meta.forEach(([label, value], index) => {
    const col = index % 2; const row = Math.floor(index / 2);
    const x = col ? 108 : 18; const yy = y + row * 12;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.text(label.toUpperCase(), x, yy);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.7); doc.text(doc.splitTextToSize(value, 78), x, yy + 5);
  });
  y += 38;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Servicios cotizados', 18, y); y += 7;

  items.forEach((item, index) => {
    y = ensureSpace(doc, y, 48);
    const title = `${index + 1}. ${String(item.product_name || 'Servicio')}`;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(doc.splitTextToSize(title, 125), 18, y);
    doc.setFontSize(9); doc.text(money(item.total_price), right, y, { align: 'right' });
    y += 6;
    const mode = humanModality(String(item.modality || item.catalog_price_mode || ''));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
    doc.text(`Fecha: ${date(item.service_date)} · ${mode} · ${Number(item.pax || 1)} pax`, 18, y); y += 5;
    doc.text(doc.splitTextToSize(modeExplanation(String(item.modality || item.catalog_price_mode || '')), 174), 18, y); y += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text('Tramos / tarifa', 18, y); y += 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
    tierLines(item).forEach(line => { y = ensureSpace(doc, y, 6); doc.text(`• ${line}`, 20, y); y += 4; });
    if (item.description) { y += 2; doc.text(doc.splitTextToSize(String(item.description), 170), 18, y); y += 7; }
    y += 3; doc.setLineWidth(0.15); doc.line(18, y, right, y); y += 7;
  });

  y = ensureSpace(doc, y, 24);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Total cotización', 18, y);
  doc.setFontSize(15); doc.text(money(quote.total), right, y, { align: 'right' }); y += 11;

  y = ensureSpace(doc, y, 48);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Políticas de cancelación — resumen', 18, y); y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2);
  concisePolicy(quote.policy_summary).forEach(line => {
    const rows = doc.splitTextToSize(`• ${line}`, 170);
    doc.text(rows, 20, y); y += rows.length * 4 + 2;
  });
  y += 2; doc.setFontSize(6.3); doc.text('Las condiciones completas aplicables a la reserva prevalecen sobre este resumen.', 18, y);

  const fileName = `${quote.quote_code}.pdf`;
  return { doc, fileName };
}

export function downloadCustomerQuote(quote: SalesQuoteSnapshot, options?: { hotelName?: string; clientName?: string }) {
  const { doc, fileName } = buildCustomerQuotePdf(quote, options);
  doc.save(fileName);
  return fileName;
}

export async function shareCustomerQuote(quote: SalesQuoteSnapshot, options?: { hotelName?: string; clientName?: string }) {
  const { doc, fileName } = buildCustomerQuotePdf(quote, options);
  const blob = doc.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({ title: `Cotización ${quote.quote_code}`, text: 'Cotización LINK Ventas', files: [file] });
    return 'shared' as const;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded' as const;
}
