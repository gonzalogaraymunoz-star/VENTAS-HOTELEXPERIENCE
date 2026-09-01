import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Banknote, Boxes, ChevronRight, CircleDollarSign, ExternalLink, LayoutDashboard,
  LogOut, Menu, Plus, RefreshCw, Search, ShoppingBag, Users, X, Kanban, CheckCircle2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { addPayment, confirmSale, createSale, loadLeads, loadPayments, loadReferenceData, loadServices, updateLeadStatus } from '../lib/sales';
import { clp, economics, resolveProductPrice } from '../lib/money';
import type { HotelPartner, Lead, LeadService, PassengerDraft, PaymentMovement, Product, Profile, ServiceDraft, Supplier } from '../types';

type Screen = 'dashboard' | 'new-sale' | 'leads' | 'pipeline' | 'products' | 'payments';

type AppData = {
  hotels: HotelPartner[];
  products: Product[];
  suppliers: Supplier[];
  leads: Lead[];
  services: LeadService[];
  payments: PaymentMovement[];
};

const emptyData: AppData = { hotels: [], products: [], suppliers: [], leads: [], services: [], payments: [] };
const channels = ['Recepción', 'QR Hotel', 'Base de datos hotel', 'Web', 'Campaña', 'Email', 'Vendedor', 'Venta directa', 'Otro'];
const pipelineStages = ['nuevo', 'contactado', 'interesado', 'cotizando', 'propuesta', 'esperando', 'confirmado', 'perdido', 'cancelado', 'dormido'];

export default function SalesApp({ profile }: { profile: Profile }) {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  async function refresh() {
    setLoading(true); setError('');
    try {
      const [ref, leads, services, payments] = await Promise.all([
        loadReferenceData(), loadLeads(), loadServices(), loadPayments(),
      ]);
      setData({ ...ref, leads, services, payments });
    } catch (e: any) {
      setError(e?.message || 'No fue posible cargar los datos.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const nav: { id: Screen; label: string; icon: any }[] = [
    { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
    { id: 'new-sale', label: 'Cotizar / vender', icon: ShoppingBag },
    { id: 'leads', label: 'Clientes', icon: Users },
    { id: 'pipeline', label: 'Pipeline', icon: Kanban },
    { id: 'products', label: 'Productos', icon: Boxes },
    { id: 'payments', label: 'Pagos', icon: Banknote },
  ];

  function go(next: Screen) { setScreen(next); setMobileOpen(false); }
  const operationsUrl = import.meta.env.VITE_OPERATIONS_URL as string | undefined;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-head">
        <div className="brand-mark inverse">LINK</div>
        <button className="icon-button sidebar-close" onClick={()=>setMobileOpen(false)}><X size={19}/></button>
      </div>
      <div className="product-name"><strong>Ventas</strong><span>HOTEL EXPERIENCE</span></div>
      <nav>
        {nav.map(item => <button key={item.id} className={`nav-item ${screen===item.id?'active':''}`} onClick={()=>go(item.id)}>
          <item.icon size={18}/><span>{item.label}</span>
        </button>)}
      </nav>
      <div className="sidebar-spacer" />
      {operationsUrl && <a className="nav-item" href={operationsUrl} target="_blank" rel="noreferrer"><ExternalLink size={18}/><span>Ir a Operaciones</span></a>}
      <button className="nav-item" onClick={()=>supabase.auth.signOut()}><LogOut size={18}/><span>Cerrar sesión</span></button>
      <div className="profile-mini"><div className="avatar">{(profile.full_name || profile.email || 'U').slice(0,1).toUpperCase()}</div><div><strong>{profile.full_name || 'Usuario'}</strong><span>{profile.role}</span></div></div>
    </aside>

    {mobileOpen && <button className="backdrop" onClick={()=>setMobileOpen(false)} aria-label="Cerrar menú"/>}

    <main className="workspace">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button>
        <div><p className="eyebrow">LINK VENTAS</p><strong>{titleFor(screen)}</strong></div>
        <div className="top-actions">
          <button className="button ghost" onClick={()=>void refresh()}><RefreshCw size={16} className={loading?'spin':''}/><span>Actualizar</span></button>
          <button className="button dark" onClick={()=>go('new-sale')}><Plus size={16}/> Cotizar</button>
        </div>
      </header>

      <section className="content-area">
        {error && <div className="error-box page-error">{error}</div>}
        {loading && data.leads.length===0 ? <div className="loading-panel">Cargando información comercial…</div> : <>
          {screen==='dashboard' && <Dashboard data={data} onNavigate={go}/>} 
          {screen==='new-sale' && <NewSale data={data} profile={profile} onCreated={async()=>{await refresh();go('leads')}}/>}
          {screen==='leads' && <LeadTable leads={data.leads} services={data.services} onConfirm={async(id)=>{await confirmSale(id);await refresh();}}/>} 
          {screen==='pipeline' && <Pipeline leads={data.leads} onChange={async(id,status)=>{await updateLeadStatus(id,status);await refresh();}}/>}
          {screen==='products' && <Products products={data.products}/>} 
          {screen==='payments' && <Payments payments={data.payments} services={data.services.filter(s=>['confirmed','completed'].includes(String(s.booking_status)))} onAdded={refresh}/>} 
        </>}
      </section>
    </main>
  </div>;
}

function titleFor(screen: Screen) {
  return ({ dashboard:'Centro comercial', 'new-sale':'Cotización / venta', leads:'Clientes y ventas', pipeline:'Pipeline comercial', products:'Catálogo', payments:'Pagos' } as Record<Screen,string>)[screen];
}

function Dashboard({ data, onNavigate }: { data: AppData; onNavigate: (screen: Screen)=>void }) {
  const confirmedServices = data.services.filter(s=>['confirmed','completed'].includes(String(s.booking_status)));
  const quotedServices = data.services.filter(s=>s.booking_status==='quoted');
  const confirmedLeads = data.leads.filter(l=>l.estado==='confirmado' || l.commercial_status==='won');
  const sales = confirmedServices.reduce((sum,s)=>sum+Number(s.precio_total ?? s.precio_venta ?? 0),0);
  const margin = confirmedServices.reduce((sum,s)=>sum+Number(s.margen_hotel_experience ?? 0),0);
  const pendingOps = confirmedServices.filter(s=>s.estado_operacion==='Pendiente').length;
  const pendingPayment = confirmedServices.filter(s=>s.estado_pago!=='Pagado').length;
  const recent = data.leads.slice(0,8);
  return <div className="screen-stack">
    <section className="hero-row">
      <div><p className="eyebrow">HOY</p><h1>Cotiza. Confirma. Entrega a operación.</h1><p className="muted large">La cotización sigue siendo editable comercialmente; solo la venta confirmada habilita el trabajo operacional.</p></div>
      <button className="button dark hero-cta" onClick={()=>onNavigate('new-sale')}>Crear cotización <ArrowRight size={17}/></button>
    </section>
    <section className="metric-grid">
      <Metric label="Clientes" value={String(data.leads.length)} hint={`${confirmedLeads.length} confirmados`} />
      <Metric label="Cotizaciones" value={String(quotedServices.length)} hint="aún no pasan a Operaciones" />
      <Metric label="Venta confirmada" value={clp(sales)} hint={`${confirmedServices.length} servicios`} />
      <Metric label="Pendientes" value={String(pendingOps + pendingPayment)} hint={`${pendingOps} operación · ${pendingPayment} pago`} />
    </section>
    <section className="two-column-grid">
      <div className="panel">
        <PanelHead title="Últimos clientes" action="Ver todos" onClick={()=>onNavigate('leads')}/>
        <div className="compact-list">{recent.length ? recent.map(l=><div className="compact-row" key={l.id}><div><strong>{l.codigo}</strong><span>{l.reserva}</span></div><div className="grow"><strong>{l.servicio || 'Sin producto'}</strong><span>{l.hotel_partners?.name || l.canal || 'Sin origen'}</span></div><Status value={l.estado}/><ChevronRight size={16}/></div>) : <Empty text="Aún no hay leads visibles."/>}</div>
      </div>
      <div className="panel">
        <PanelHead title="Frontera Ventas → Operaciones" action="Pipeline" onClick={()=>onNavigate('pipeline')}/>
        <div className="handoff-flow"><FlowStep n="1" title="Cotización" text="Lead, pasajeros y productos quedan estructurados sin activar operación."/><FlowStep n="2" title="Confirmación" text="Los mismos servicios pasan de quoted a confirmed."/><FlowStep n="3" title="Operaciones" text="Se habilitan handoff, asignaciones y comisiones sobre la venta confirmada."/></div>
      </div>
    </section>
    {margin < 0 && <div className="error-box">Hay servicios confirmados con margen LINK/HE negativo.</div>}
  </div>;
}

function Metric({label,value,hint}:{label:string;value:string;hint:string}) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>; }
function PanelHead({title,action,onClick}:{title:string;action:string;onClick:()=>void}) { return <div className="panel-head"><h2>{title}</h2><button onClick={onClick}>{action} <ChevronRight size={15}/></button></div>; }
function FlowStep({n,title,text}:{n:string;title:string;text:string}) { return <div className="flow-step"><span>{n}</span><div><strong>{title}</strong><p>{text}</p></div></div>; }
function Empty({text}:{text:string}) { return <div className="empty-state">{text}</div>; }
function Status({value}:{value:string}) { const key=(value||'').toLowerCase(); return <span className={`status status-${key}`}>{value || 'Pendiente'}</span>; }

function LeadTable({ leads, services, onConfirm }: { leads: Lead[]; services: LeadService[]; onConfirm:(leadId:string)=>Promise<void> }) {
  const [query,setQuery]=useState(''); const [busy,setBusy]=useState(''); const [message,setMessage]=useState('');
  const rows=useMemo(()=>leads.filter(l=>`${l.codigo} ${l.reserva} ${l.servicio} ${l.contacto} ${l.hotel_partners?.name}`.toLowerCase().includes(query.toLowerCase())),[leads,query]);
  const servicesFor=(leadId:string)=>services.filter(s=>s.lead_id===leadId);
  const canConfirm=(leadId:string)=>servicesFor(leadId).some(s=>s.booking_status==='quoted');
  async function confirm(id:string){setBusy(id);setMessage('');try{await onConfirm(id);setMessage('Venta confirmada y entregada a Operaciones.')}catch(e:any){setMessage(e?.message||'No se pudo confirmar la venta.')}finally{setBusy('')}}
  return <div className="screen-stack">
    <section className="page-heading"><div><p className="eyebrow">CRM COMERCIAL</p><h1>Clientes</h1><p className="muted">El mismo código conecta cotización, pasajeros, productos, pagos y operación.</p></div></section>
    {message&&<div className={message.startsWith('Venta confirmada')?'success-box':'error-box'}>{message}</div>}
    <div className="toolbar"><div className="search-box"><Search size={17}/><input placeholder="Buscar código, reserva, producto, hotel…" value={query} onChange={e=>setQuery(e.target.value)}/></div><span>{rows.length} registros</span></div>
    <div className="table-shell"><table><thead><tr><th>Código</th><th>Origen</th><th>Contacto</th><th>Productos</th><th>Total</th><th>Estado</th><th>Próxima acción</th><th>Acción</th></tr></thead><tbody>{rows.map(l=><tr key={l.id}><td><strong>{l.codigo}</strong><small>{l.reserva}</small></td><td>{l.hotel_partners?.name || l.canal || '—'}</td><td>{l.contacto || '—'}</td><td>{servicesFor(l.id).length}<small>{l.servicio || 'Sin detalle'}</small></td><td>{clp(l.precio_venta)}</td><td><Status value={l.estado}/></td><td>{l.next_best_action || '—'}</td><td>{canConfirm(l.id)?<button className="button dark" disabled={busy===l.id} onClick={()=>void confirm(l.id)}>{busy===l.id?'Confirmando…':'Confirmar venta'}</button>:<span className="muted">{l.estado==='confirmado'?'En Operaciones':'—'}</span>}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No hay coincidencias."/>}</div>
  </div>;
}

function Pipeline({ leads, onChange }: { leads: Lead[]; onChange:(id:string,status:string)=>Promise<void> }) {
  const [busy,setBusy]=useState('');
  return <div className="screen-stack"><section className="page-heading"><div><p className="eyebrow">CONVERSIÓN</p><h1>Pipeline</h1><p className="muted">Cada estado responde qué está pendiente. Confirmado ejecuta el handoff real, no solo cambia una etiqueta.</p></div></section><div className="kanban-board">{pipelineStages.map(stage=><section className="kanban-column" key={stage}><header><strong>{stage}</strong><span>{leads.filter(l=>(l.estado||'nuevo').toLowerCase()===stage).length}</span></header><div>{leads.filter(l=>(l.estado||'nuevo').toLowerCase()===stage).map(l=><article className="kanban-card" key={l.id}><div className="kanban-code">{l.codigo}</div><strong>{l.servicio || 'Lead sin producto'}</strong><p>{l.hotel_partners?.name || l.canal || 'Sin origen'}</p><small>{l.next_best_action || clp(l.precio_venta)}</small><select disabled={busy===l.id} value={(l.estado||'nuevo').toLowerCase()} onChange={async e=>{setBusy(l.id);try{await onChange(l.id,e.target.value)}finally{setBusy('')}}}>{pipelineStages.map(s=><option key={s}>{s}</option>)}</select></article>)}</div></section>)}</div></div>;
}

function Products({ products }: { products: Product[] }) {
  const [query,setQuery]=useState(''); const [category,setCategory]=useState('Todos');
  const categories=['Todos',...Array.from(new Set(products.map(p=>p.category)))];
  const rows=products.filter(p=>(category==='Todos'||p.category===category)&&`${p.name} ${p.code} ${p.category}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="screen-stack"><section className="page-heading"><div><p className="eyebrow">SUPABASE · FUENTE DE VERDAD</p><h1>Productos</h1><p className="muted">Precio, identidad y tratamiento tributario nacen del catálogo; no inferimos reglas por el nombre del producto.</p></div></section><div className="toolbar wrap"><div className="search-box"><Search size={17}/><input placeholder="Buscar producto…" value={query} onChange={e=>setQuery(e.target.value)}/></div><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></div><div className="product-grid">{rows.map(p=><article className="product-card" key={p.id}><span className="product-code">{p.code}</span><h3>{p.name}</h3><p>{p.description || p.category}</p><div><span>{p.category} · {taxLabel(p)}</span><strong>{priceLabel(p)}</strong></div></article>)}</div></div>;
}
function priceLabel(p:Product){const v=resolveProductPrice(p,2);return v===null?'Cotización manual':`${clp(v)}${Object.prototype.hasOwnProperty.call(p.prices,'2')?' p/p':''}`}
function taxLabel(p:Product){if(p.tax_treatment==='exempt')return 'Exento';if(p.tax_treatment==='taxable')return p.tax_rate!=null?`Afecto ${p.tax_rate}%`:'Afecto · tasa por definir';return 'Tributación por definir'}

function Payments({ payments, services, onAdded }: { payments:PaymentMovement[];services:LeadService[];onAdded:()=>Promise<void> }) {
  const [serviceId,setServiceId]=useState(''); const [amount,setAmount]=useState(''); const [method,setMethod]=useState('Transferencia'); const [reference,setReference]=useState(''); const [counterparty,setCounterparty]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  async function submit(){setBusy(true);setMessage('');try{await addPayment({serviceId,amount:Number(amount),paymentMethod:method,reference,counterparty});setAmount('');setReference('');setCounterparty('');setMessage('Pago registrado.');await onAdded();}catch(e:any){setMessage(e?.message||'No se pudo registrar.')}finally{setBusy(false)}}
  return <div className="screen-stack"><section className="page-heading"><div><p className="eyebrow">CAJA</p><h1>Pagos</h1><p className="muted">Solo aparecen servicios confirmados. Una cotización todavía no es una cuenta por cobrar.</p></div></section><section className="payment-layout"><div className="panel payment-form"><h2>Registrar ingreso</h2><label>Producto vendido<select value={serviceId} onChange={e=>setServiceId(e.target.value)}><option value="">Seleccionar…</option>{services.map(s=><option key={s.id} value={s.id}>{s.service_code || s.leads?.codigo} · {s.producto} · {clp(s.precio_total ?? s.precio_venta)}</option>)}</select></label><div className="form-grid two"><label>Monto CLP<input type="number" min="0" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Medio<select value={method} onChange={e=>setMethod(e.target.value)}><option>Transferencia</option><option>Tarjeta</option><option>Efectivo</option><option>Pix / Wise</option><option>Otro</option></select></label></div><label>Pagador<input value={counterparty} onChange={e=>setCounterparty(e.target.value)} placeholder="Nombre o referencia"/></label><label>Referencia<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Comprobante / operación"/></label>{message&&<div className={message==='Pago registrado.'?'success-box':'error-box'}>{message}</div>}<button className="button dark wide" disabled={busy} onClick={()=>void submit()}>{busy?'Guardando…':'Registrar pago'}</button></div><div className="panel"><h2>Últimos movimientos</h2><div className="compact-list">{payments.map(p=><div className="compact-row" key={p.id}><CircleDollarSign size={18}/><div className="grow"><strong>{p.payment_code || p.lead_services?.service_code || 'Pago'}</strong><span>{p.lead_services?.leads?.codigo} · {p.lead_services?.producto || p.counterparty_name}</span></div><div className="money-right"><strong>{clp(p.amount)}</strong><span>{p.payment_method || '—'}</span></div></div>)}{!payments.length&&<Empty text="Sin movimientos registrados."/>}</div></div></section></div>;
}

function NewSale({ data, profile, onCreated }:{data:AppData;profile:Profile;onCreated:()=>Promise<void>}) {
  const [hotelId,setHotelId]=useState(data.hotels[0]?.id||'');
  const [channel,setChannel]=useState('Recepción'); const [priority,setPriority]=useState('Media'); const [checkin,setCheckin]=useState(''); const [checkout,setCheckout]=useState(''); const [contact,setContact]=useState(''); const [sellerName,setSellerName]=useState(profile.full_name||profile.email||''); const [notes,setNotes]=useState('');
  const [passengers,setPassengers]=useState<PassengerDraft[]>([blankPassenger(true)]);
  const [services,setServices]=useState<ServiceDraft[]>([]); const [productId,setProductId]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [createdCode,setCreatedCode]=useState(''); const [createdLeadId,setCreatedLeadId]=useState(''); const [createdStatus,setCreatedStatus]=useState<'quoted'|'confirmed'|''>('');

  useEffect(()=>{if(!hotelId&&data.hotels[0])setHotelId(data.hotels[0].id)},[data.hotels,hotelId]);
  function patchPassenger(i:number,patch:Partial<PassengerDraft>){setPassengers(prev=>prev.map((p,idx)=>idx===i?{...p,...patch}:p))}
  function addPassenger(){setPassengers(prev=>[...prev,blankPassenger(false)])}
  function removePassenger(i:number){if(i===0)return;setPassengers(prev=>prev.filter((_,idx)=>idx!==i))}
  function addSelectedProduct(){const p=data.products.find(x=>x.id===productId);if(!p)return;const pax=Math.max(1,passengers.length);const known=resolveProductPrice(p,pax);setServices(prev=>[...prev,{product_id:p.id,product_code:p.code,product_name:p.name,category:p.category,date:'',start_time:'',pax,modality:p.price_mode,unit_price:known??0,operator_cost:0,supplier_id:'',supplier_name:'',hotel_commission_pct:15,seller_commission_pct:5,notes:''}]);setProductId('')}
  function patchService(i:number,patch:Partial<ServiceDraft>){setServices(prev=>prev.map((s,idx)=>idx===i?{...s,...patch}:s))}
  async function submit(confirmNow:boolean){setBusy(true);setMessage('');try{const result=await createSale({hotelPartnerId:hotelId,channel,priority,checkin,checkout,contact,sellerName,passengers,services,notes},confirmNow);setCreatedLeadId(result.lead_id);setCreatedCode(result.lead_code);setCreatedStatus(result.status);setMessage(result.status==='confirmed'?'Venta confirmada y entregada a Operaciones.':'Cotización guardada. Aún no está disponible para Operaciones.');}catch(e:any){setMessage(e?.message||'No fue posible guardar.')}finally{setBusy(false)}}
  async function confirmCreated(){if(!createdLeadId)return;setBusy(true);setMessage('');try{await confirmSale(createdLeadId);setCreatedStatus('confirmed');setMessage('Venta confirmada y entregada a Operaciones.')}catch(e:any){setMessage(e?.message||'No se pudo confirmar.')}finally{setBusy(false)}}
  const topActions=createdCode ? <div className="top-actions">{createdStatus==='quoted'&&<button className="button ghost" disabled={busy} onClick={()=>void confirmCreated()}>{busy?'Confirmando…':'Confirmar cotización'}</button>}<button className="button dark" onClick={()=>void onCreated()}><CheckCircle2 size={17}/>{createdCode} · Ver clientes</button></div> : <div className="top-actions"><button className="button ghost" disabled={busy} onClick={()=>void submit(false)}>{busy?'Guardando…':'Guardar cotización'}</button><button className="button dark" disabled={busy} onClick={()=>void submit(true)}>Confirmar venta <ArrowRight size={17}/></button></div>;

  return <div className="screen-stack sale-builder"><section className="page-heading sticky-title"><div><p className="eyebrow">COTIZACIÓN / VENTA</p><h1>Una oportunidad, un código, dos momentos.</h1><p className="muted">Primero puedes guardar el trabajo comercial. Solo Confirmar venta habilita Operaciones, pagos y comisiones.</p></div>{topActions}</section>

    <section className="builder-section"><SectionNumber n="01" title="Origen y responsable" text="Define de dónde proviene la oportunidad y quién la convierte."/><div className="form-grid four"><label>Hotel / negocio<select value={hotelId} onChange={e=>setHotelId(e.target.value)}><option value="">Seleccionar…</option>{data.hotels.map(h=><option key={h.id} value={h.id}>{h.name} · {h.lead_prefix||'sin prefijo'}</option>)}</select></label><label>Canal<select value={channel} onChange={e=>setChannel(e.target.value)}>{channels.map(c=><option key={c}>{c}</option>)}</select></label><label>Vendedor<input value={sellerName} onChange={e=>setSellerName(e.target.value)}/></label><label>Prioridad<select value={priority} onChange={e=>setPriority(e.target.value)}><option>Alta</option><option>Media</option><option>Baja</option></select></label></div><div className="form-grid three"><label>Contacto principal<input value={contact} onChange={e=>setContact(e.target.value)} placeholder="Teléfono, email o ambos"/></label><label>Check-in<input type="date" value={checkin} onChange={e=>setCheckin(e.target.value)}/></label><label>Check-out<input type="date" value={checkout} onChange={e=>setCheckout(e.target.value)}/></label></div></section>

    <section className="builder-section"><div className="section-title-row"><SectionNumber n="02" title="Cliente y acompañantes" text="Todos pertenecen al mismo Lead y reciben LEAD-P01, P02, P03…"/><button className="button ghost" onClick={addPassenger}><Plus size={16}/> Acompañante</button></div><div className="passenger-stack">{passengers.map((p,i)=><article className="passenger-row" key={i}><div className="passenger-index"><span>{i===0?'CLIENTE':'ACOMPAÑANTE'}</span><strong>P{String(i+1).padStart(2,'0')}</strong></div><div className="form-grid passenger-fields"><label>Nombre completo<input value={p.full_name} onChange={e=>patchPassenger(i,{full_name:e.target.value})} placeholder="Nombre y apellido"/></label><label>Email<input type="email" value={p.email} onChange={e=>patchPassenger(i,{email:e.target.value})}/></label><label>Teléfono<input value={p.phone} onChange={e=>patchPassenger(i,{phone:e.target.value})}/></label><label>Nacionalidad<input value={p.nationality} onChange={e=>patchPassenger(i,{nationality:e.target.value})}/></label><label>Documento<input value={p.document_number} onChange={e=>patchPassenger(i,{document_number:e.target.value})}/></label><label>Nacimiento<input type="date" value={p.birth_date} onChange={e=>patchPassenger(i,{birth_date:e.target.value})}/></label></div>{i>0&&<button className="icon-button danger" onClick={()=>removePassenger(i)}><X size={17}/></button>}</article>)}</div></section>

    <section className="builder-section"><div className="section-title-row"><SectionNumber n="03" title="Productos" text="Siempre nacen del catálogo. Si falta tarifa, queda como cotización manual y no inventamos precio."/><div className="add-product-control"><select value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Elegir del catálogo…</option>{data.products.map(p=><option key={p.id} value={p.id}>{p.category} · {p.name}</option>)}</select><button className="button dark" onClick={addSelectedProduct} disabled={!productId}><Plus size={16}/> Agregar</button></div></div>{!services.length?<Empty text="Agrega el primer producto de la cotización."/>:<div className="service-stack">{services.map((s,i)=>{const calc=economics(s.unit_price,s.pax,s.operator_cost,s.hotel_commission_pct,s.seller_commission_pct);const p=data.products.find(x=>x.id===s.product_id);return <article className="service-card" key={`${s.product_id}-${i}`}><header><div><span className="product-code">{s.product_code}</span><h3>{s.product_name}</h3><p>{s.category} · {s.modality} · {p?taxLabel(p):'Tributación por definir'}</p></div><button className="icon-button danger" onClick={()=>setServices(prev=>prev.filter((_,idx)=>idx!==i))}><X size={17}/></button></header><div className="form-grid five"><label>Fecha<input type="date" value={s.date} onChange={e=>patchService(i,{date:e.target.value})}/></label><label>Hora<input type="time" value={s.start_time} onChange={e=>patchService(i,{start_time:e.target.value})}/></label><label>Pax<input type="number" min="1" value={s.pax} onChange={e=>patchService(i,{pax:Number(e.target.value)})}/></label><label>Precio p/p<input type="number" min="0" value={s.unit_price} onChange={e=>patchService(i,{unit_price:Number(e.target.value)})}/></label><label>Costo operador total<input type="number" min="0" value={s.operator_cost} onChange={e=>patchService(i,{operator_cost:Number(e.target.value)})}/></label></div><div className="form-grid three"><label>Operador propuesto<select value={s.supplier_id} onChange={e=>{const supplier=data.suppliers.find(x=>x.id===e.target.value);patchService(i,{supplier_id:e.target.value,supplier_name:supplier?.name||''})}}><option value="">Por definir</option>{data.suppliers.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label>Comisión hotel % margen<input type="number" min="0" max="100" value={s.hotel_commission_pct} onChange={e=>patchService(i,{hotel_commission_pct:Number(e.target.value)})}/></label><label>Comisión vendedor % margen<input type="number" min="0" max="100" value={s.seller_commission_pct} onChange={e=>patchService(i,{seller_commission_pct:Number(e.target.value)})}/></label></div><div className="economics-strip"><div><span>Venta</span><strong>{clp(calc.total)}</strong></div><div><span>Costo operador</span><strong>{clp(calc.cost)}</strong></div><div><span>Margen comercial</span><strong className={calc.margin<0?'negative':''}>{clp(calc.margin)}</strong></div><div><span>Hotel</span><strong>{clp(calc.hotel)}</strong></div><div><span>Vendedor</span><strong>{clp(calc.seller)}</strong></div><div><span>LINK / HE</span><strong>{clp(calc.platform)}</strong></div></div><label>Observaciones del producto<textarea value={s.notes} onChange={e=>patchService(i,{notes:e.target.value})} placeholder="Información comercial que debe acompañar este servicio."/></label></article>})}</div>}</section>

    <section className="builder-section"><SectionNumber n="04" title="Cierre" text="Guardar cotización mantiene el trabajo en Ventas. Confirmar venta activa los mismos servicios en Operaciones."/><label>Observaciones generales<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Condiciones, acuerdos, información pendiente…"/></label>{message&&<div className={createdCode?'success-box':'error-box'}>{message}</div>}<div className="closing-bar"><div><span>{passengers.length} pasajeros</span><span>{services.length} productos</span><strong>{clp(services.reduce((sum,s)=>sum+economics(s.unit_price,s.pax,s.operator_cost,s.hotel_commission_pct,s.seller_commission_pct).total,0))}</strong></div>{!createdCode&&<div className="top-actions"><button className="button ghost big" disabled={busy} onClick={()=>void submit(false)}>{busy?'Guardando…':'Guardar cotización'}</button><button className="button dark big" disabled={busy} onClick={()=>void submit(true)}>{busy?'Procesando…':'Confirmar venta y enviar a Operaciones'} <ArrowRight size={17}/></button></div>}</div></section>
  </div>;
}

function blankPassenger(primary:boolean):PassengerDraft{return{full_name:'',email:'',phone:'',nationality:'',document_type:'Pasaporte',document_number:'',birth_date:'',dietary_restrictions:'',is_primary:primary}}
function SectionNumber({n,title,text}:{n:string;title:string;text:string}){return <div className="section-number"><span>{n}</span><div><h2>{title}</h2><p>{text}</p></div></div>}
