import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Banknote, Boxes, CalendarDays, CheckCircle2, ChevronRight, CircleDollarSign,
  Clock3, ExternalLink, FileText, Layers3, Minus, Plus, Search, ShoppingBag, Users,
} from 'lucide-react';
import { addPayment } from '../lib/sales';
import { clp, resolveProductPrice } from '../lib/money';
import type { Lead, LeadService, PaymentMovement, Product } from '../types';
import './SalesWorkspaces.css';

const CONFIRMED = new Set(['confirmed', 'completed']);
const PAX_STEPS = Array.from({ length: 12 }, (_, index) => index + 1);

function saleValue(service: LeadService) {
  return Number(service.precio_total ?? service.precio_venta ?? 0);
}

function paidForService(serviceId: string, payments: PaymentMovement[]) {
  return payments
    .filter(payment => payment.lead_service_id === serviceId && (!payment.direction || payment.direction === 'inflow'))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function leadName(lead?: Lead | null) {
  if (!lead) return 'Cliente';
  return lead.reserva && lead.reserva !== lead.codigo ? lead.reserva : lead.codigo;
}

function dateLabel(value?: string | null) {
  if (!value) return 'Fecha por definir';
  return new Date(`${value}T12:00:00`).toLocaleDateString('es-CL');
}

function accountStatus(total: number, paid: number) {
  if (total > 0 && paid >= total) return 'Pagado';
  if (paid > 0) return 'Parcial';
  return 'Pendiente';
}

export function ActionDashboard({
  leads,
  services,
  payments,
  onQuote,
  onClients,
  onPipeline,
  onOpenPayments,
  onConfirm,
  operationsUrl,
}: {
  leads: Lead[];
  services: LeadService[];
  payments: PaymentMovement[];
  onQuote: () => void;
  onClients: () => void;
  onPipeline: () => void;
  onOpenPayments: (leadId?: string) => void;
  onConfirm: (leadId: string) => Promise<void>;
  operationsUrl?: string;
}) {
  const [busyLead, setBusyLead] = useState('');
  const quoted = services.filter(service => service.booking_status === 'quoted');
  const confirmed = services.filter(service => CONFIRMED.has(String(service.booking_status)));

  const quoteRows = useMemo(() => {
    const ids = Array.from(new Set(quoted.map(service => service.lead_id)));
    return ids.map(leadId => {
      const lead = leads.find(item => item.id === leadId);
      const items = quoted.filter(service => service.lead_id === leadId);
      return {
        leadId,
        lead,
        items,
        total: items.reduce((sum, service) => sum + saleValue(service), 0),
      };
    }).sort((a, b) => b.total - a.total);
  }, [leads, quoted]);

  const collectionRows = useMemo(() => {
    const ids = Array.from(new Set(confirmed.map(service => service.lead_id)));
    return ids.map(leadId => {
      const lead = leads.find(item => item.id === leadId);
      const items = confirmed.filter(service => service.lead_id === leadId);
      const total = items.reduce((sum, service) => sum + saleValue(service), 0);
      const paid = items.reduce((sum, service) => sum + paidForService(service.id, payments), 0);
      return { leadId, lead, items, total, paid, balance: Math.max(0, total - paid) };
    }).filter(row => row.balance > 0).sort((a, b) => b.balance - a.balance);
  }, [leads, confirmed, payments]);

  const operationRows = confirmed
    .filter(service => String(service.estado_operacion || '').toLowerCase() === 'pendiente')
    .sort((a, b) => String(a.fecha_servicio || '').localeCompare(String(b.fecha_servicio || '')));

  const quoteTotal = quoteRows.reduce((sum, row) => sum + row.total, 0);
  const pendingCollection = collectionRows.reduce((sum, row) => sum + row.balance, 0);

  async function confirmLead(leadId: string) {
    setBusyLead(leadId);
    try {
      await onConfirm(leadId);
    } finally {
      setBusyLead('');
    }
  }

  return <div className="screen-stack action-dashboard">
    <section className="work-hero">
      <div>
        <p className="eyebrow">CENTRO DE TRABAJO</p>
        <h1>¿Qué hay que hacer ahora?</h1>
        <p>Inicio muestra solo trabajo accionable: cotizaciones por cerrar, dinero por cobrar y ventas que deben pasar a ejecución.</p>
      </div>
      <button className="button dark big" onClick={onQuote}><ShoppingBag size={17}/> Nueva cotización</button>
    </section>

    <section className="work-summary-grid">
      <button onClick={onClients} className="work-summary-card">
        <span><FileText size={17}/> Cotizaciones por cerrar</span>
        <strong>{quoteRows.length}</strong>
        <small>{clp(quoteTotal)} en propuestas abiertas</small>
        <ChevronRight size={17}/>
      </button>
      <button onClick={()=>onOpenPayments()} className="work-summary-card">
        <span><CircleDollarSign size={17}/> Por cobrar</span>
        <strong>{clp(pendingCollection)}</strong>
        <small>{collectionRows.length} cuenta(s) con saldo</small>
        <ChevronRight size={17}/>
      </button>
      <button onClick={onPipeline} className="work-summary-card">
        <span><Clock3 size={17}/> Listo para operación</span>
        <strong>{operationRows.length}</strong>
        <small>servicios confirmados pendientes de coordinación</small>
        <ChevronRight size={17}/>
      </button>
    </section>

    <section className="work-columns">
      <div className="work-panel">
        <header><div><p className="eyebrow">VENTAS</p><h2>Cotizaciones por cerrar</h2></div><button onClick={onClients}>Ver clientes <ChevronRight size={14}/></button></header>
        <div className="work-list">
          {quoteRows.slice(0, 6).map(row => <article key={row.leadId}>
            <div className="work-row-main">
              <span className="work-code">{row.lead?.codigo || 'Lead'}</span>
              <strong>{leadName(row.lead)}</strong>
              <small>{row.items.map(item => item.producto).join(' · ')}</small>
            </div>
            <div className="work-row-money"><strong>{clp(row.total)}</strong><span>{row.items.length} servicio(s)</span></div>
            <button className="button dark compact-action" disabled={busyLead===row.leadId} onClick={()=>void confirmLead(row.leadId)}>{busyLead===row.leadId?'Confirmando…':'Confirmar'}</button>
          </article>)}
          {!quoteRows.length && <div className="work-empty"><CheckCircle2 size={20}/><strong>Sin cotizaciones esperando cierre.</strong><span>Puedes crear una nueva oportunidad desde Cotizar / vender.</span></div>}
        </div>
      </div>

      <div className="work-panel">
        <header><div><p className="eyebrow">CAJA</p><h2>Cobros pendientes</h2></div><button onClick={()=>onOpenPayments()}>Abrir cuentas <ChevronRight size={14}/></button></header>
        <div className="work-list">
          {collectionRows.slice(0, 6).map(row => <article key={row.leadId}>
            <div className="work-row-main">
              <span className="work-code">{row.lead?.codigo || 'Venta'}</span>
              <strong>{leadName(row.lead)}</strong>
              <small>{clp(row.paid)} abonado de {clp(row.total)}</small>
            </div>
            <div className="work-row-money"><strong>{clp(row.balance)}</strong><span>saldo</span></div>
            <button className="button ghost compact-action" onClick={()=>onOpenPayments(row.leadId)}>Cobrar</button>
          </article>)}
          {!collectionRows.length && <div className="work-empty"><CheckCircle2 size={20}/><strong>Sin saldos pendientes.</strong><span>Las ventas confirmadas están pagadas o todavía no tienen monto.</span></div>}
        </div>
      </div>

      <div className="work-panel operations-panel">
        <header><div><p className="eyebrow">HANDOFF</p><h2>Ventas listas para operar</h2></div>{operationsUrl&&<a href={operationsUrl} target="_blank" rel="noreferrer">Abrir Operaciones <ExternalLink size={13}/></a>}</header>
        <div className="work-list">
          {operationRows.slice(0, 6).map(service => {
            const lead = leads.find(item => item.id === service.lead_id);
            return <article key={service.id}>
              <div className="work-row-main">
                <span className="work-code">{service.service_code || lead?.codigo}</span>
                <strong>{service.producto}</strong>
                <small>{leadName(lead)} · {dateLabel(service.fecha_servicio)} · {service.numero_pax || 1} pax</small>
              </div>
              <span className="ready-chip">Confirmado</span>
            </article>;
          })}
          {!operationRows.length && <div className="work-empty"><CheckCircle2 size={20}/><strong>No hay handoffs pendientes.</strong><span>Las ventas nuevas aparecerán aquí después de confirmarlas.</span></div>}
        </div>
      </div>
    </section>
  </div>;
}

type ProductFamily = {
  key: string;
  name: string;
  category: string;
  products: Product[];
};

function priceModeLabel(mode: string) {
  return ({
    private_per_pax: 'Privado por pax',
    regular_per_pax: 'Compartido por pax',
    regular_commission: 'Regular / comisión',
    hotel_fixed: 'Precio por servicio',
    lowcost_transport: 'Transporte por servicio',
  } as Record<string, string>)[mode] || mode.replaceAll('_', ' ');
}

function catalogQuote(product: Product, pax: number) {
  const unitPrice = resolveProductPrice(product, pax);
  if (unitPrice === null || unitPrice <= 0) return { valid: false, unitPrice: 0, total: 0, unit: '' };
  const perService = product.price_mode === 'hotel_fixed' || product.price_mode === 'lowcost_transport';
  return {
    valid: true,
    unitPrice,
    total: perService ? unitPrice : unitPrice * pax,
    unit: perService ? 'por servicio' : 'por persona',
  };
}

function productTax(product: Product) {
  if (product.tax_treatment === 'exempt') return 'Exento';
  if (product.tax_treatment === 'taxable') return product.tax_rate != null ? `Afecto ${product.tax_rate}%` : 'Afecto';
  return 'Tributación por definir';
}

export function ProductWorkspace({ products, onQuote }: { products: Product[]; onQuote: (productId: string) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todos');
  const [selectedKey, setSelectedKey] = useState('');
  const [pax, setPax] = useState(2);

  const families = useMemo<ProductFamily[]>(() => {
    const map = new Map<string, ProductFamily>();
    products.forEach(product => {
      const key = `${product.category}::${product.name}`.toLowerCase();
      const current = map.get(key) || { key, name: product.name, category: product.category, products: [] };
      current.products.push(product);
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [products]);

  const categories = useMemo(() => ['Todos', ...Array.from(new Set(families.map(family => family.category)))], [families]);
  const filtered = useMemo(() => families.filter(family => {
    const haystack = [family.name, family.category, ...family.products.map(product => `${product.code} ${product.description || ''}`)].join(' ').toLowerCase();
    return (category === 'Todos' || family.category === category) && haystack.includes(query.toLowerCase().trim());
  }), [families, category, query]);

  useEffect(() => {
    if (!filtered.length) return;
    if (!selectedKey || !filtered.some(family => family.key === selectedKey)) setSelectedKey(filtered[0].key);
  }, [filtered, selectedKey]);

  const selected = filtered.find(family => family.key === selectedKey) || filtered[0] || null;
  const primary = selected?.products[0] || null;

  return <div className="screen-stack catalog-workspace">
    <section className="catalog-workspace-head">
      <div><p className="eyebrow">CATÁLOGO COMERCIAL</p><h1>Busca, compara y cotiza.</h1><p>La misma lógica dinámica de HOTEL EXPERIENCE, usando el catálogo real de Supabase como fuente de verdad.</p></div>
      <div className="catalog-counter"><span>Productos activos</span><strong>{products.length}</strong><small>{families.length} familias comerciales</small></div>
    </section>

    <section className="catalog-browser-layout">
      <aside className="catalog-browser">
        <div className="catalog-search"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar experiencia, código…"/></div>
        <select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select>
        <div className="catalog-family-list">
          {filtered.map(family => <button key={family.key} className={selected?.key===family.key?'active':''} onClick={()=>setSelectedKey(family.key)}>
            <span><strong>{family.name}</strong><small>{family.category}</small></span><em>{family.products.length}</em>
          </button>)}
          {!filtered.length && <div className="work-empty"><Search size={19}/><strong>Sin resultados.</strong><span>Prueba otra búsqueda o categoría.</span></div>}
        </div>
      </aside>

      {selected && primary && <div className="catalog-detail">
        <header className="catalog-detail-head">
          <div><p className="eyebrow">{selected.category}</p><h2>{selected.name}</h2><p>{primary.description || primary.schedule || 'Servicio disponible en el catálogo comercial.'}</p></div>
          <div className="catalog-facts">
            {primary.duration_hours != null && <span><Clock3 size={14}/>{primary.duration_hours} h</span>}
            {primary.schedule && <span><CalendarDays size={14}/>{primary.schedule}</span>}
            <span><Layers3 size={14}/>{selected.products.length} modalidad(es)</span>
          </div>
        </header>

        <div className="pax-control">
          <div><Users size={18}/><span><strong>Cotizar para</strong><small>La tarifa cambia según pax cuando el catálogo tiene tramos.</small></span></div>
          <div className="pax-stepper-v2"><button onClick={()=>setPax(Math.max(1,pax-1))}><Minus size={15}/></button><strong>{pax}</strong><span>pax</span><button onClick={()=>setPax(Math.min(12,pax+1))}><Plus size={15}/></button></div>
        </div>

        <div className="variant-grid">
          {selected.products.map(product => {
            const quote = catalogQuote(product, pax);
            return <article key={product.id} className={quote.valid?'variant-card':'variant-card manual'}>
              <div className="variant-top"><span><strong>{priceModeLabel(product.price_mode)}</strong><small>{product.code}</small></span><i>{productTax(product)}</i></div>
              {quote.valid ? <><div className="variant-price"><strong>{clp(quote.unitPrice)}</strong><span>{quote.unit}</span></div><div className="variant-total"><span>Total {pax} pax</span><strong>{clp(quote.total)}</strong></div></> : <div className="variant-manual"><strong>Cotización manual</strong><span>No existe una tarifa automática para este tramo.</span></div>}
              <button className="button dark wide" onClick={()=>onQuote(product.id)}><ShoppingBag size={15}/> Usar en cotización</button>
            </article>;
          })}
        </div>

        <div className="price-matrix-card">
          <header><div><Boxes size={17}/><span><strong>Tramos completos</strong><small>Selecciona una fila para cambiar el pax de la cotización.</small></span></div><b>1–12 PAX</b></header>
          <div className="price-matrix-scroll"><table>
            <thead><tr><th>Pax</th>{selected.products.map(product=><th key={product.id}>{priceModeLabel(product.price_mode)}<small>{product.code}</small></th>)}</tr></thead>
            <tbody>{PAX_STEPS.map(amount => <tr key={amount} className={amount===pax?'selected':''} onClick={()=>setPax(amount)}><td><strong>{amount}</strong></td>{selected.products.map(product=>{const quote=catalogQuote(product,amount);return <td key={product.id}>{quote.valid?<><strong>{clp(quote.unitPrice)}</strong><small>Total {clp(quote.total)}</small></>:<span className="matrix-manual">Cotizar</span>}</td>})}</tr>)}</tbody>
          </table></div>
        </div>
      </div>}
    </section>
  </div>;
}

type AccountRow = {
  leadId: string;
  lead?: Lead;
  services: LeadService[];
  total: number;
  paid: number;
  balance: number;
};

export function AccountWorkspace({
  leads,
  services,
  payments,
  initialLeadId,
  onAdded,
}: {
  leads: Lead[];
  services: LeadService[];
  payments: PaymentMovement[];
  initialLeadId?: string;
  onAdded: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'pending'|'all'>('pending');
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId || '');
  const [serviceId, setServiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Transferencia');
  const [reference, setReference] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const accounts = useMemo<AccountRow[]>(() => {
    const leadIds = Array.from(new Set(services.map(service => service.lead_id)));
    return leadIds.map(leadId => {
      const lead = leads.find(item => item.id === leadId);
      const items = services.filter(service => service.lead_id === leadId);
      const total = items.reduce((sum, service) => sum + saleValue(service), 0);
      const paid = items.reduce((sum, service) => sum + paidForService(service.id, payments), 0);
      return { leadId, lead, services: items, total, paid, balance: Math.max(0, total - paid) };
    }).sort((a, b) => b.balance - a.balance || b.total - a.total);
  }, [leads, services, payments]);

  const visibleAccounts = accounts.filter(account => {
    const matches = `${account.lead?.codigo || ''} ${leadName(account.lead)} ${account.services.map(service=>service.producto).join(' ')}`.toLowerCase().includes(query.toLowerCase().trim());
    return matches && (scope === 'all' || account.balance > 0);
  });

  useEffect(() => {
    if (initialLeadId && accounts.some(account => account.leadId === initialLeadId)) setSelectedLeadId(initialLeadId);
  }, [initialLeadId, accounts]);

  useEffect(() => {
    if (!visibleAccounts.length) return;
    if (!selectedLeadId || !visibleAccounts.some(account => account.leadId === selectedLeadId)) setSelectedLeadId(visibleAccounts[0].leadId);
  }, [visibleAccounts, selectedLeadId]);

  const selected = accounts.find(account => account.leadId === selectedLeadId) || null;
  const selectedPayments = selected ? payments.filter(payment => selected.services.some(service => service.id === payment.lead_service_id) && (!payment.direction || payment.direction === 'inflow')) : [];

  useEffect(() => {
    if (!selected) return;
    const firstPending = selected.services.find(service => saleValue(service) > paidForService(service.id, payments)) || selected.services[0];
    setServiceId(firstPending?.id || '');
    setCounterparty(leadName(selected.lead));
    setAmount('');
    setReference('');
    setMessage('');
  }, [selectedLeadId]);

  const selectedService = selected?.services.find(service => service.id === serviceId) || null;
  const serviceBalance = selectedService ? Math.max(0, saleValue(selectedService) - paidForService(selectedService.id, payments)) : 0;

  async function submitPayment() {
    if (!selected || !serviceId) return;
    setBusy(true); setMessage('');
    try {
      await addPayment({ serviceId, amount: Number(amount), paymentMethod: method, reference, counterparty });
      setAmount(''); setReference(''); setMessage('Abono registrado correctamente.');
      await onAdded();
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo registrar el abono.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="screen-stack account-workspace">
    <section className="account-heading"><div><p className="eyebrow">CAJA / CUENTAS</p><h1>Estado de cuenta por cliente.</h1><p>Una venta se lee como un documento: qué compró, cuánto vale, cuánto abonó y qué saldo queda.</p></div><div className="account-heading-total"><span>Saldo total por cobrar</span><strong>{clp(accounts.reduce((sum, account)=>sum+account.balance,0))}</strong></div></section>

    <section className="account-layout">
      <aside className="account-browser">
        <div className="account-search"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar cliente o código…"/></div>
        <div className="account-tabs"><button className={scope==='pending'?'active':''} onClick={()=>setScope('pending')}>Por cobrar</button><button className={scope==='all'?'active':''} onClick={()=>setScope('all')}>Todas</button></div>
        <div className="account-list">
          {visibleAccounts.map(account => <button key={account.leadId} className={selectedLeadId===account.leadId?'active':''} onClick={()=>setSelectedLeadId(account.leadId)}>
            <div><span>{account.lead?.codigo || 'Venta'}</span><strong>{leadName(account.lead)}</strong><small>{account.services.length} servicio(s)</small></div>
            <div className="account-list-money"><strong>{clp(account.balance)}</strong><span>{accountStatus(account.total, account.paid)}</span></div>
          </button>)}
          {!visibleAccounts.length && <div className="work-empty"><CheckCircle2 size={20}/><strong>Sin cuentas en este filtro.</strong><span>Las ventas confirmadas aparecerán agrupadas por cliente.</span></div>}
        </div>
      </aside>

      {selected ? <div className="account-document">
        <section className="statement-sheet">
          <header className="statement-header">
            <div><span className="statement-brand">LINK VENTAS</span><p>HOTEL EXPERIENCE</p></div>
            <div className="statement-title"><span>ESTADO DE CUENTA</span><strong>{selected.lead?.codigo}</strong><small>{new Date().toLocaleDateString('es-CL')}</small></div>
          </header>

          <div className="statement-client">
            <div><span>Cliente</span><strong>{leadName(selected.lead)}</strong><small>{selected.lead?.contacto || 'Contacto no informado'}</small></div>
            <div><span>Origen</span><strong>{selected.lead?.hotel_partners?.name || selected.lead?.canal || 'Venta directa'}</strong><small>{selected.lead?.checkin ? `Check-in ${dateLabel(selected.lead.checkin)}` : 'Sin estadía asociada'}</small></div>
            <div><span>Estado</span><strong>{accountStatus(selected.total, selected.paid)}</strong><small>{selected.services.length} servicio(s) confirmados</small></div>
          </div>

          <div className="statement-lines"><table>
            <thead><tr><th>Servicio</th><th>Fecha</th><th>Pax</th><th>Precio unit.</th><th>Total</th><th>Abonado</th><th>Saldo</th></tr></thead>
            <tbody>{selected.services.map(service => {
              const total = saleValue(service);
              const paid = paidForService(service.id, payments);
              return <tr key={service.id}><td><strong>{service.producto}</strong><small>{service.service_code || service.tour_id || 'Servicio'}</small></td><td>{dateLabel(service.fecha_servicio)}</td><td>{service.numero_pax || 1}</td><td>{service.precio_unitario != null ? clp(service.precio_unitario) : '—'}</td><td>{clp(total)}</td><td>{clp(paid)}</td><td><strong>{clp(Math.max(0,total-paid))}</strong></td></tr>;
            })}</tbody>
          </table></div>

          <div className="statement-totals">
            <div><span>Total venta</span><strong>{clp(selected.total)}</strong></div>
            <div><span>Abonos recibidos</span><strong>{clp(selected.paid)}</strong></div>
            <div className="statement-balance"><span>Saldo pendiente</span><strong>{clp(selected.balance)}</strong></div>
          </div>
        </section>

        <section className="account-bottom-grid">
          <div className="payment-entry-card">
            <header><div><p className="eyebrow">REGISTRAR ABONO</p><h2>Aplicar pago a un servicio</h2></div><Banknote size={20}/></header>
            <label>Servicio<select value={serviceId} onChange={event=>setServiceId(event.target.value)}>{selected.services.map(service=><option key={service.id} value={service.id}>{service.service_code || service.producto} · saldo {clp(Math.max(0,saleValue(service)-paidForService(service.id,payments)))}</option>)}</select></label>
            <div className="form-grid two"><label>Monto<input type="number" min="0" max={serviceBalance || undefined} value={amount} onChange={event=>setAmount(event.target.value)} placeholder={serviceBalance ? `Máx. ${clp(serviceBalance)}` : '0'}/></label><label>Medio<select value={method} onChange={event=>setMethod(event.target.value)}><option>Transferencia</option><option>Tarjeta</option><option>Efectivo</option><option>Pix / Wise</option><option>Otro</option></select></label></div>
            <label>Pagador<input value={counterparty} onChange={event=>setCounterparty(event.target.value)}/></label>
            <label>Referencia / comprobante<input value={reference} onChange={event=>setReference(event.target.value)} placeholder="N° operación, comprobante, referencia…"/></label>
            {message && <div className={message.startsWith('Abono registrado')?'success-box':'error-box'}>{message}</div>}
            <button className="button dark wide" disabled={busy || !serviceId || !(Number(amount)>0)} onClick={()=>void submitPayment()}>{busy?'Registrando…':'Registrar abono'} <ArrowRight size={15}/></button>
          </div>

          <div className="payment-history-card">
            <header><div><p className="eyebrow">MOVIMIENTOS</p><h2>Historial de pagos</h2></div><span>{selectedPayments.length}</span></header>
            <div className="payment-history-list">
              {selectedPayments.map(payment => <article key={payment.id}><div><strong>{payment.payment_code || 'Pago'}</strong><span>{new Date(payment.paid_at).toLocaleDateString('es-CL')} · {payment.payment_method || 'Sin medio'}</span></div><div><strong>{clp(payment.amount)}</strong><span>{payment.reference || 'Sin referencia'}</span></div></article>)}
              {!selectedPayments.length && <div className="work-empty"><Banknote size={20}/><strong>Sin abonos registrados.</strong><span>El primer movimiento aparecerá aquí.</span></div>}
            </div>
          </div>
        </section>
      </div> : <div className="account-document-empty"><FileText size={28}/><strong>Selecciona una cuenta.</strong><span>Verás el detalle completo de lo adquirido y sus pagos.</span></div>}
    </section>
  </div>;
}
