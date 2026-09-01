import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, CheckCircle2, Download, FileText, ReceiptText, Search, Share2,
} from 'lucide-react';
import { recordServiceDocumentIssue, registerClientPayment } from '../lib/sales';
import { clp } from '../lib/money';
import { downloadServiceInvoice, shareServiceInvoice, type ServiceInvoiceData } from '../lib/serviceInvoice';
import type { Lead, LeadService, PaymentMovement } from '../types';
import './ClientPaymentsWorkspace.css';

type AccountRow = {
  leadId: string;
  lead?: Lead;
  services: LeadService[];
  total: number;
  paid: number;
  balance: number;
};

const saleValue = (service: LeadService) => Number(service.precio_total ?? service.precio_venta ?? 0);

function movementPaid(service: LeadService, payments: PaymentMovement[]) {
  return payments
    .filter(payment => payment.lead_service_id === service.id && (!payment.direction || payment.direction === 'inflow'))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function effectivePaid(service: LeadService, payments: PaymentMovement[]) {
  const quantified = movementPaid(service, payments);
  if (quantified > 0) return quantified;
  return service.estado_pago === 'Pagado' ? saleValue(service) : 0;
}

function leadName(lead?: Lead | null) {
  if (!lead) return 'Cliente';
  return lead.reserva && lead.reserva !== lead.codigo ? lead.reserva : lead.codigo;
}

function dateLabel(value?: string | null) {
  if (!value) return 'Por definir';
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-CL');
}

function accountStatus(total: number, paid: number) {
  if (total > 0 && paid >= total) return 'Pagado';
  if (paid > 0) return 'Parcial';
  return 'Pendiente';
}

function taxLabel(service: LeadService) {
  if (service.tax_treatment_snapshot === 'exempt') return 'Exento';
  if (service.tax_treatment_snapshot === 'taxable') return service.tax_rate_snapshot != null ? `Afecto ${service.tax_rate_snapshot}%` : 'Afecto';
  return 'Tributación por definir';
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="client-payment-empty"><CheckCircle2 size={21}/><strong>{title}</strong><span>{text}</span></div>;
}

export function AccountWorkspace({
  leads, services, payments, initialLeadId, onAdded,
}: {
  leads: Lead[];
  services: LeadService[];
  payments: PaymentMovement[];
  initialLeadId?: string;
  onAdded: () => Promise<void>;
}) {
  const activeServices = useMemo(() => services.filter(service => service.booking_status === 'confirmed'), [services]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId || '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Transferencia');
  const [reference, setReference] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [busy, setBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [message, setMessage] = useState('');

  const accounts = useMemo<AccountRow[]>(() => Array.from(new Set(activeServices.map(service => service.lead_id))).map(leadId => {
    const items = activeServices.filter(service => service.lead_id === leadId);
    const total = items.reduce((sum, service) => sum + saleValue(service), 0);
    const paid = items.reduce((sum, service) => sum + effectivePaid(service, payments), 0);
    return {
      leadId,
      lead: leads.find(item => item.id === leadId),
      services: items,
      total,
      paid,
      balance: Math.max(0, total - paid),
    };
  }).sort((a, b) => b.balance - a.balance || b.total - a.total), [leads, activeServices, payments]);

  const visible = accounts.filter(account => {
    const haystack = `${account.lead?.codigo || ''} ${leadName(account.lead)} ${account.services.map(service => service.producto).join(' ')}`.toLowerCase();
    return haystack.includes(query.toLowerCase().trim()) && (scope === 'all' || account.balance > 0);
  });

  useEffect(() => {
    if (initialLeadId && accounts.some(account => account.leadId === initialLeadId)) setSelectedLeadId(initialLeadId);
  }, [initialLeadId, accounts]);

  useEffect(() => {
    if (visible.length && (!selectedLeadId || !visible.some(account => account.leadId === selectedLeadId))) setSelectedLeadId(visible[0].leadId);
  }, [visible, selectedLeadId]);

  const selected = accounts.find(account => account.leadId === selectedLeadId) || null;
  const selectedPayments = selected ? payments.filter(payment => selected.services.some(service => service.id === payment.lead_service_id) && (!payment.direction || payment.direction === 'inflow')) : [];

  useEffect(() => {
    if (!selected) return;
    setCounterparty(leadName(selected.lead));
    setAmount('');
    setReference('');
    setMessage('');
  }, [selectedLeadId]);

  function invoiceData(): ServiceInvoiceData | null {
    if (!selected) return null;
    return {
      leadCode: selected.lead?.codigo || 'VENTA',
      clientName: leadName(selected.lead),
      contact: selected.lead?.contacto || '',
      origin: selected.lead?.hotel_partners?.name || selected.lead?.canal || 'Venta directa',
      seller: selected.services.find(service => service.seller_name)?.seller_name || '',
      status: accountStatus(selected.total, selected.paid),
      total: selected.total,
      paid: selected.paid,
      balance: selected.balance,
      lines: selected.services.map(service => {
        const total = saleValue(service);
        const paid = effectivePaid(service, payments);
        return {
          code: service.service_code || service.tour_id || 'Servicio',
          name: service.producto,
          date: dateLabel(service.fecha_servicio),
          pax: service.numero_pax || 1,
          unitPrice: service.precio_unitario != null ? Number(service.precio_unitario) : null,
          total,
          paid,
          balance: Math.max(0, total - paid),
          taxLabel: taxLabel(service),
        };
      }),
      payments: selectedPayments.map(payment => ({
        code: payment.payment_code || 'Pago',
        date: new Date(payment.paid_at).toLocaleDateString('es-CL'),
        method: payment.payment_method || 'Sin medio',
        amount: Number(payment.amount || 0),
        reference: payment.reference || '',
      })),
    };
  }

  async function submitPayment() {
    if (!selected) return;
    const numericAmount = Number(amount);
    if (!(numericAmount > 0)) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await registerClientPayment({
        leadId: selected.leadId,
        amount: numericAmount,
        paymentMethod: method,
        reference,
        counterparty,
      });
      setAmount('');
      setReference('');
      setMessage(`Pago registrado. ${result.allocated_services} servicio(s) actualizado(s).`);
      await onAdded();
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo registrar el pago.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!selected) return;
    const data = invoiceData();
    if (!data) return;
    setDocumentBusy(true);
    setMessage('');
    try {
      downloadServiceInvoice(data);
      await recordServiceDocumentIssue(selected.leadId, 'downloaded');
      setMessage('Factura proforma PDF descargada.');
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo generar el PDF.');
    } finally {
      setDocumentBusy(false);
    }
  }

  async function sharePdf() {
    if (!selected) return;
    const data = invoiceData();
    if (!data) return;
    setDocumentBusy(true);
    setMessage('');
    try {
      const result = await shareServiceInvoice(data);
      await recordServiceDocumentIssue(selected.leadId, result === 'shared' ? 'shared' : 'downloaded');
      setMessage(result === 'shared' ? 'Documento enviado al selector de compartir.' : 'Este dispositivo no permite adjuntar por compartir; el PDF fue descargado.');
    } catch (error: any) {
      if (error?.name === 'AbortError') setMessage('Compartir cancelado.');
      else setMessage(error?.message || 'No se pudo compartir el PDF.');
    } finally {
      setDocumentBusy(false);
    }
  }

  const totalReceivable = accounts.reduce((sum, account) => sum + account.balance, 0);

  return <div className="screen-stack client-payments-workspace">
    <section className="client-payments-heading">
      <div><p className="eyebrow">COBROS DE CLIENTES</p><h1>Cobra la venta, no cada línea.</h1><p>Registra un monto recibido y LINK lo distribuye sobre los servicios pendientes. El documento comercial se genera desde la misma venta.</p></div>
      <div className="client-payments-total"><span>Saldo por cobrar</span><strong>{clp(totalReceivable)}</strong><small>{accounts.filter(account => account.balance > 0).length} cuenta(s) pendientes</small></div>
    </section>

    <section className="client-payments-layout">
      <aside className="client-account-browser">
        <div className="client-account-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar cliente o código…"/></div>
        <div className="client-account-tabs"><button className={scope === 'pending' ? 'active' : ''} onClick={() => setScope('pending')}>Por cobrar</button><button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>Activas</button></div>
        <div className="client-account-list">{visible.map(account => <button key={account.leadId} className={selectedLeadId === account.leadId ? 'active' : ''} onClick={() => setSelectedLeadId(account.leadId)}><div><span>{account.lead?.codigo || 'Venta'}</span><strong>{leadName(account.lead)}</strong><small>{account.services.length} servicio(s)</small></div><div><strong>{clp(account.balance)}</strong><small>{accountStatus(account.total, account.paid)}</small></div></button>)}{!visible.length && <EmptyState title="Sin cuentas en este filtro." text="Las ventas confirmadas aparecerán agrupadas por cliente."/>}</div>
      </aside>

      {selected ? <div className="client-account-document">
        <section className="client-invoice-sheet">
          <header className="client-invoice-header"><div><span className="client-invoice-brand">LINK VENTAS</span><small>HOTEL EXPERIENCE</small></div><div className="client-invoice-identity"><span>FACTURA PROFORMA DE SERVICIOS</span><strong>{selected.lead?.codigo}</strong><small>{new Date().toLocaleDateString('es-CL')}</small></div></header>
          <div className="client-invoice-actions"><div><ReceiptText size={16}/><span>Documento comercial no tributario · no reemplaza DTE/SII</span></div><div><button className="button ghost" disabled={documentBusy} onClick={() => void downloadPdf()}><Download size={15}/> Descargar PDF</button><button className="button dark" disabled={documentBusy} onClick={() => void sharePdf()}><Share2 size={15}/> Enviar / compartir</button></div></div>

          <div className="client-invoice-meta"><div><span>Cliente</span><strong>{leadName(selected.lead)}</strong><small>{selected.lead?.contacto || 'Contacto no informado'}</small></div><div><span>Origen</span><strong>{selected.lead?.hotel_partners?.name || selected.lead?.canal || 'Venta directa'}</strong><small>{selected.lead?.checkin ? `Check-in ${dateLabel(selected.lead.checkin)}` : 'Sin estadía asociada'}</small></div><div><span>Estado</span><strong>{accountStatus(selected.total, selected.paid)}</strong><small>{selected.services.length} servicio(s) confirmados</small></div></div>

          <div className="client-invoice-table"><table><thead><tr><th>Servicio</th><th>Fecha</th><th>Pax</th><th>Precio unit.</th><th>Total</th><th>Abonado</th><th>Saldo</th></tr></thead><tbody>{selected.services.map(service => {const total = saleValue(service); const paid = effectivePaid(service, payments); return <tr key={service.id}><td><strong>{service.producto}</strong><small>{service.service_code || service.tour_id || 'Servicio'} · {taxLabel(service)}</small></td><td>{dateLabel(service.fecha_servicio)}</td><td>{service.numero_pax || 1}</td><td>{service.precio_unitario != null ? clp(service.precio_unitario) : '—'}</td><td>{clp(total)}</td><td>{clp(paid)}</td><td><strong>{clp(Math.max(0, total - paid))}</strong></td></tr>})}</tbody></table></div>

          <div className="client-invoice-mobile-lines">{selected.services.map(service => {const total = saleValue(service); const paid = effectivePaid(service, payments); const balance = Math.max(0, total - paid); return <article key={service.id}><header><div><strong>{service.producto}</strong><small>{service.service_code || service.tour_id || 'Servicio'}</small></div><strong>{clp(total)}</strong></header><div className="client-mobile-service-meta"><span>{dateLabel(service.fecha_servicio)}</span><span>{service.numero_pax || 1} pax</span><span>{taxLabel(service)}</span></div><div className="client-mobile-money"><div><span>Total</span><strong>{clp(total)}</strong></div><div><span>Abonado</span><strong>{clp(paid)}</strong></div><div><span>Saldo</span><strong>{clp(balance)}</strong></div></div></article>})}</div>

          <div className="client-invoice-totals"><div><span>Total servicios</span><strong>{clp(selected.total)}</strong></div><div><span>Pagos recibidos</span><strong>{clp(selected.paid)}</strong></div><div className="balance"><span>Saldo pendiente</span><strong>{clp(selected.balance)}</strong></div></div>
        </section>

        <section className="client-payment-bottom">
          <div className="client-payment-entry"><header><div><p className="eyebrow">REGISTRAR COBRO</p><h2>Pago del cliente</h2><p>El monto se distribuye automáticamente por fecha entre los servicios con saldo.</p></div><Banknote size={21}/></header><div className="client-quick-balance"><span>Saldo de esta venta</span><strong>{clp(selected.balance)}</strong><button type="button" onClick={() => setAmount(String(selected.balance))} disabled={selected.balance <= 0}>Usar saldo completo</button></div><div className="client-payment-form-grid"><label>Monto recibido<input type="number" min="0" max={selected.balance || undefined} value={amount} onChange={event => setAmount(event.target.value)} placeholder={selected.balance ? `Máx. ${clp(selected.balance)}` : '0'}/></label><label>Medio<select value={method} onChange={event => setMethod(event.target.value)}><option>Transferencia</option><option>Tarjeta</option><option>Efectivo</option><option>Pix / Wise</option><option>Otro</option></select></label></div><label>Pagador<input value={counterparty} onChange={event => setCounterparty(event.target.value)}/></label><label>Referencia / comprobante<input value={reference} onChange={event => setReference(event.target.value)} placeholder="N° operación, comprobante, referencia…"/></label>{message && <div className={message.startsWith('Pago registrado') || message.includes('PDF') || message.includes('enviado') || message.includes('descargado') ? 'success-box' : 'error-box'}>{message}</div>}<button className="button dark wide big" disabled={busy || selected.balance <= 0 || !(Number(amount) > 0) || Number(amount) > selected.balance} onClick={() => void submitPayment()}>{busy ? 'Registrando…' : 'Registrar pago del cliente'}</button></div>

          <div className="client-payment-history"><header><div><p className="eyebrow">MOVIMIENTOS</p><h2>Pagos recibidos</h2></div><span>{selectedPayments.length}</span></header><div>{selectedPayments.map(payment => <article key={payment.id}><div><strong>{payment.payment_code || 'Pago'}</strong><span>{new Date(payment.paid_at).toLocaleDateString('es-CL')} · {payment.payment_method || 'Sin medio'}</span><small>{payment.reference || 'Sin referencia'}</small></div><strong>{clp(payment.amount)}</strong></article>)}{!selectedPayments.length && <div className="client-payment-empty"><FileText size={21}/><strong>Sin movimientos cuantificados.</strong><span>Los estados históricos se respetan sin inventar pagos retroactivos.</span></div>}</div></div>
        </section>
      </div> : <div className="client-payment-no-selection"><FileText size={28}/><strong>Selecciona una cuenta.</strong><span>Verás servicios, pagos, saldo y documento digital.</span></div>}
    </section>
  </div>;
}
