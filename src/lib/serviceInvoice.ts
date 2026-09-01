import { jsPDF } from 'jspdf';

export type ServiceInvoiceLine = {
  code: string;
  name: string;
  date: string;
  pax: number;
  unitPrice: number | null;
  total: number;
  paid: number;
  balance: number;
  taxLabel?: string;
};

export type ServiceInvoicePayment = {
  code: string;
  date: string;
  method: string;
  amount: number;
  reference?: string;
};

export type ServiceInvoiceData = {
  leadCode: string;
  clientName: string;
  contact: string;
  origin: string;
  seller?: string;
  status: string;
  total: number;
  paid: number;
  balance: number;
  lines: ServiceInvoiceLine[];
  payments: ServiceInvoicePayment[];
};

const money = (value: number) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(Number(value || 0));

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

function ensureSpace(doc: jsPDF, y: number, needed = 16) {
  if (y + needed <= 278) return y;
  doc.addPage();
  return 18;
}

export function createServiceInvoicePdf(data: ServiceInvoiceData) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const right = pageWidth - 18;
  let y = 18;

  doc.setTextColor(15, 15, 15);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('LINK VENTAS', 18, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(95, 95, 95);
  doc.text('HOTEL EXPERIENCE', 18, y + 5);

  doc.setTextColor(15, 15, 15);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('FACTURA PROFORMA DE SERVICIOS', right, y, { align: 'right' });
  doc.setFontSize(13);
  doc.text(data.leadCode || 'VENTA', right, y + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text(new Date().toLocaleDateString('es-CL'), right, y + 11, { align: 'right' });

  y += 19;
  doc.setDrawColor(25, 25, 25);
  doc.setLineWidth(0.45);
  doc.line(18, y, right, y);
  y += 9;

  const meta = [
    ['Cliente', data.clientName || 'Cliente'],
    ['Contacto', data.contact || 'No informado'],
    ['Origen', data.origin || 'Venta directa'],
    ['Vendedor', data.seller || 'No informado'],
    ['Estado', data.status],
  ];
  meta.forEach(([label, value], index) => {
    const col = index % 2;
    if (index > 0 && col === 0) y += 13;
    const x = col === 0 ? 18 : 110;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 120, 120);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(25, 25, 25);
    const wrapped = doc.splitTextToSize(value || '—', col === 0 ? 80 : 78);
    doc.text(wrapped, x, y + 4.5);
  });
  y += 18;

  y = ensureSpace(doc, y, 28);
  doc.setFillColor(247, 246, 242);
  doc.rect(18, y, right - 18, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(90, 90, 90);
  doc.text('SERVICIO', 20, y + 5);
  doc.text('FECHA', 98, y + 5);
  doc.text('PAX', 122, y + 5);
  doc.text('TOTAL', 151, y + 5, { align: 'right' });
  doc.text('ABONADO', 174, y + 5, { align: 'right' });
  doc.text('SALDO', right - 1, y + 5, { align: 'right' });
  y += 10;

  for (const line of data.lines) {
    const titleLines = doc.splitTextToSize(line.name || 'Servicio', 70);
    const rowHeight = Math.max(13, titleLines.length * 4.2 + 8);
    y = ensureSpace(doc, y, rowHeight + 3);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(25, 25, 25);
    doc.text(titleLines, 20, y + 3);
    const subY = y + 3 + titleLines.length * 4.2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(120, 120, 120);
    doc.text(`${line.code || 'Servicio'}${line.taxLabel ? ` · ${line.taxLabel}` : ''}`, 20, subY);

    doc.setFontSize(7.3);
    doc.setTextColor(40, 40, 40);
    doc.text(line.date || 'Por definir', 98, y + 4);
    doc.text(String(line.pax || 1), 124, y + 4);
    doc.text(money(line.total), 151, y + 4, { align: 'right' });
    doc.text(money(line.paid), 174, y + 4, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(money(line.balance), right - 1, y + 4, { align: 'right' });
    doc.setDrawColor(225, 225, 222);
    doc.setLineWidth(0.2);
    doc.line(18, y + rowHeight, right, y + rowHeight);
    y += rowHeight + 2;
  }

  y = ensureSpace(doc, y + 4, 32);
  const totalsX = 124;
  const valueX = right;
  const totals = [
    ['Total servicios', data.total],
    ['Pagos recibidos', data.paid],
    ['Saldo pendiente', data.balance],
  ] as const;
  totals.forEach(([label, value], index) => {
    if (index === 2) {
      doc.setDrawColor(25, 25, 25);
      doc.setLineWidth(0.45);
      doc.line(totalsX, y - 2, valueX, y - 2);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(index === 2 ? 8 : 7);
    doc.setTextColor(65, 65, 65);
    doc.text(label, totalsX, y + 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(index === 2 ? 13 : 8);
    doc.setTextColor(20, 20, 20);
    doc.text(money(value), valueX, y + 4, { align: 'right' });
    y += index === 2 ? 11 : 8;
  });

  if (data.payments.length) {
    y = ensureSpace(doc, y + 4, 25);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(25, 25, 25);
    doc.text('PAGOS REGISTRADOS', 18, y);
    y += 6;
    data.payments.forEach(payment => {
      y = ensureSpace(doc, y, 10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.text(payment.code || 'Pago', 18, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(90, 90, 90);
      doc.text(`${payment.date} · ${payment.method || 'Sin medio'}`, 18, y + 4);
      if (payment.reference) doc.text(doc.splitTextToSize(payment.reference, 90), 78, y + 4);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(25, 25, 25);
      doc.text(money(payment.amount), right, y, { align: 'right' });
      y += 10;
    });
  }

  y = ensureSpace(doc, y + 5, 24);
  doc.setFillColor(248, 247, 244);
  doc.roundedRect(18, y, right - 18, 18, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(70, 70, 70);
  doc.text('DOCUMENTO COMERCIAL NO TRIBUTARIO', 22, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.text(doc.splitTextToSize('Esta factura proforma / estado de servicios documenta la venta y sus pagos en LINK Ventas. No reemplaza una factura, boleta o DTE autorizado por el SII.', right - 26), 22, y + 11);

  const fileName = `Factura-proforma-${safeName(data.leadCode || 'servicios') || 'servicios'}.pdf`;
  return { doc, fileName };
}

export function downloadServiceInvoice(data: ServiceInvoiceData) {
  const { doc, fileName } = createServiceInvoicePdf(data);
  doc.save(fileName);
  return fileName;
}

export async function shareServiceInvoice(data: ServiceInvoiceData) {
  const { doc, fileName } = createServiceInvoicePdf(data);
  const blob = doc.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const shareNavigator = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (shareNavigator.share && (!shareNavigator.canShare || shareNavigator.canShare({ files: [file] }))) {
    await shareNavigator.share({
      title: `Servicios ${data.leadCode}`,
      text: `Factura proforma / estado de servicios ${data.leadCode}`,
      files: [file],
    });
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
