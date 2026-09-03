import { useEffect, useState } from 'react';
import { Banknote, BookOpen, Boxes, ExternalLink, LayoutDashboard, LogOut, Menu, Plus, RefreshCw, ShoppingBag, Users, X, Kanban } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { loadLeads, loadPayments, loadReferenceData, loadServices } from '../lib/sales';
import type { HotelPartner, Lead, LeadService, PaymentMovement, Product, Profile, SellerProfile, Supplier } from '../types';
import VisualCatalog from './VisualCatalog';
import SalesFlowForm from './SalesFlowForm';
import { ProductWorkspace } from './SalesWorkspaces';
import { AccountWorkspace } from './ClientPaymentsWorkspace';
import { ReservationClientsWorkspace, ReservationDashboard, ReservationPipeline } from './ReservationWorkspaces';

type Screen = 'dashboard' | 'new-sale' | 'leads' | 'pipeline' | 'catalog' | 'products' | 'payments';

type AppData = {
  hotels: HotelPartner[];
  products: Product[];
  suppliers: Supplier[];
  sellers: SellerProfile[];
  leads: Lead[];
  services: LeadService[];
  payments: PaymentMovement[];
};

const emptyData: AppData = { hotels: [], products: [], suppliers: [], sellers: [], leads: [], services: [], payments: [] };

export default function SalesAppV2({ profile }: { profile: Profile }) {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editLeadId, setEditLeadId] = useState('');
  const [initialProductId, setInitialProductId] = useState('');
  const [paymentLeadId, setPaymentLeadId] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try {
      const [reference, leads, services, payments] = await Promise.all([
        loadReferenceData(), loadLeads(), loadServices(), loadPayments(),
      ]);
      const activeLeads = leads.filter(lead => String(lead.lifecycle_stage || 'commercial') !== 'historical');
      const activeLeadIds = new Set(activeLeads.map(lead => lead.id));
      const activeServices = services.filter(service => activeLeadIds.has(service.lead_id));
      const activeServiceIds = new Set(activeServices.map(service => service.id));
      const activePayments = payments.filter(payment => Boolean(payment.lead_service_id && activeServiceIds.has(payment.lead_service_id)));
      setData({ ...reference, leads: activeLeads, services: activeServices, payments: activePayments });
    } catch (e: any) {
      setError(e?.message || 'No fue posible cargar los datos.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  const nav: { id: Screen; label: string; icon: any }[] = [
    { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
    { id: 'new-sale', label: 'Cotización e ingreso', icon: ShoppingBag },
    { id: 'catalog', label: 'Catálogo', icon: BookOpen },
    { id: 'leads', label: 'Clientes', icon: Users },
    { id: 'pipeline', label: 'Pipeline', icon: Kanban },
    { id: 'products', label: 'Productos', icon: Boxes },
    { id: 'payments', label: 'Cobros', icon: Banknote },
  ];

  function go(next: Screen) { setScreen(next); setMobileOpen(false); }
  function newIntake(productId = '') { setEditLeadId(''); setInitialProductId(productId); go('new-sale'); }
  function editIntake(leadId: string) { setEditLeadId(leadId); setInitialProductId(''); go('new-sale'); }
  function openPayments(leadId = '') { setPaymentLeadId(leadId); go('payments'); }
  const operationsUrl = import.meta.env.VITE_OPERATIONS_URL as string | undefined;
  const confirmedServices = data.services.filter(service => ['confirmed', 'completed'].includes(String(service.booking_status)));

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-head"><div className="brand-mark inverse">LINK</div><button className="icon-button sidebar-close" onClick={() => setMobileOpen(false)}><X size={19}/></button></div>
      <div className="product-name"><strong>Ventas</strong><span>HOTEL EXPERIENCE</span></div>
      <nav>{nav.map(item => <button key={item.id} className={`nav-item ${screen === item.id ? 'active' : ''}`} onClick={() => item.id === 'new-sale' ? newIntake() : go(item.id)}><item.icon size={18}/><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-spacer"/>
      {operationsUrl && <a className="nav-item" href={operationsUrl} target="_blank" rel="noreferrer"><ExternalLink size={18}/><span>Ir a Operaciones</span></a>}
      <button className="nav-item" onClick={() => supabase.auth.signOut()}><LogOut size={18}/><span>Cerrar sesión</span></button>
      <div className="profile-mini"><div className="avatar">{(profile.full_name || profile.email || 'U').slice(0, 1).toUpperCase()}</div><div><strong>{profile.full_name || 'Usuario'}</strong><span>{profile.role}</span></div></div>
    </aside>

    {mobileOpen && <button className="backdrop" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"/>}

    <main className="workspace">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20}/></button>
        <div><p className="eyebrow">LINK VENTAS</p><strong>{titleFor(screen)}</strong></div>
        <div className="top-actions"><button className="button ghost" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'spin' : ''}/><span>Actualizar</span></button><button className="button dark" onClick={() => newIntake()}><Plus size={16}/> Nueva cotización</button></div>
      </header>

      <section className="content-area">
        {error && <div className="error-box page-error">{error}</div>}
        {loading && data.leads.length === 0 ? <div className="loading-panel">Cargando información comercial…</div> : <>
          {screen === 'dashboard' && <ReservationDashboard leads={data.leads} services={data.services} payments={data.payments} onNew={() => newIntake()} onEdit={editIntake} onClients={() => go('leads')} onPayments={() => openPayments()} onPipeline={() => go('pipeline')}/>} 
          {screen === 'new-sale' && <SalesFlowForm profile={profile} hotels={data.hotels} products={data.products} suppliers={data.suppliers} sellers={data.sellers} leads={data.leads} services={data.services} initialLeadId={editLeadId} initialProductId={initialProductId} operationsUrl={operationsUrl} onSaved={refresh} onCompleted={async () => { await refresh(); setEditLeadId(''); setInitialProductId(''); go('leads'); }}/>} 
          {screen === 'catalog' && <VisualCatalog products={data.products} onQuote={productId => newIntake(productId)}/>} 
          {screen === 'leads' && <ReservationClientsWorkspace leads={data.leads} services={data.services} onEditDraft={editIntake} onUpdated={refresh}/>} 
          {screen === 'pipeline' && <ReservationPipeline leads={data.leads} onUpdated={refresh}/>} 
          {screen === 'products' && <ProductWorkspace products={data.products} onQuote={productId => newIntake(productId)}/>} 
          {screen === 'payments' && <AccountWorkspace leads={data.leads} payments={data.payments} services={confirmedServices} initialLeadId={paymentLeadId} onAdded={refresh}/>} 
        </>}
      </section>
    </main>
  </div>;
}

function titleFor(screen: Screen) {
  return ({
    dashboard: 'Centro de trabajo',
    'new-sale': 'Cotización e ingreso',
    catalog: 'Catálogo visual',
    leads: 'Clientes y reservas',
    pipeline: 'Pipeline comercial',
    products: 'Productos y tarifas',
    payments: 'Cobros y documentos',
  } as Record<Screen, string>)[screen];
}
