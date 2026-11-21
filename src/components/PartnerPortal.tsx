import React,{useEffect,useState} from 'react';
import {ArrowRight,CheckCircle2,ClipboardList,Hotel,KeyRound,LogOut,Plus,RefreshCw,ShieldCheck,Trash2,UserRound} from 'lucide-react';
import {supabase} from '../lib/supabase';
import ProductCatalogView,{type PortalCatalogSelection} from './ProductCatalogView';
import type {CatalogProduct} from '../lib/portalPricing';
import './PartnerPortal.css';

type HotelOption={id:string;name:string;slug:string};
type Identity={
  mode:'hotel'|'seller'|'admin';
  name:string;
  email?:string;
  access_code?:string;
  partner_type?:string;
  can_create_requests:boolean;
  hotel_partner_id?:string;
};
type PartnerService={
  id:string;
  producto:string;
  fecha_servicio?:string|null;
  numero_pax:number;
  estado:string;
  idioma?:string|null;
  hotel_partner_id?:string;
};
type PartnerLead={
  id:string;codigo:string;reserva:string;numero_pax:number;contacto:string;
  empresa_ejecuta:string;estado:string;estado_raw:string;created_at:string;
  hotel_partner_id:string;
  services:PartnerService[];
};
type PortalData={
  identity:Identity;
  hotels:HotelOption[];
  catalogExtras:CatalogProduct[];
  summary:{total:number;confirmed:number;pending:number;quoted:number};
  leads:PartnerLead[];
  preview_safe?:boolean;
  preview_notice?:string;
};
type SelectedService=PortalCatalogSelection&{key:string;date:string;notes:string};
const PREVIEW_REQUESTS_KEY='link-ventas-seller-desk-preview-requests-v1';
const PREVIEW_PRODUCTION_ORIGIN='https://link-ventas-hotel.pages.dev';
const isPagesPreviewHost=window.location.hostname.endsWith('.link-ventas-hotel.pages.dev')&&window.location.hostname!=='link-ventas-hotel.pages.dev';
function readPreviewLeads():PartnerLead[]{
  try{
    const value=JSON.parse(localStorage.getItem(PREVIEW_REQUESTS_KEY)||'[]');
    return Array.isArray(value)?value:[];
  }catch{return [];}
}

export default function PartnerPortal(){
  const [identity,setIdentity]=useState<Identity|null>(null);
  const [data,setData]=useState<PortalData|null>(null);
  const [checking,setChecking]=useState(true);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [accessCode,setAccessCode]=useState('');
  const [partnerPassword,setPartnerPassword]=useState('');
  const [sellerEmail,setSellerEmail]=useState('');
  const [sellerPassword,setSellerPassword]=useState('');
  const [loginMode,setLoginMode]=useState<'hotel'|'seller'>('hotel');
  const [sellerToken,setSellerToken]=useState('');
  const [tab,setTab]=useState<'reservations'|'catalog'|'new'>('catalog');
  const [selectedHotelId,setSelectedHotelId]=useState('');
  const [selectedServices,setSelectedServices]=useState<SelectedService[]>([]);
  const [notice,setNotice]=useState('');
  const [handoffWaiting,setHandoffWaiting]=useState(false);

  async function loadData(token?:string){
    setLoading(true);setError('');
    try{
      const headers:Record<string,string>={};
      if(token)headers.Authorization='Bearer '+token;
      const response=await fetch('/api/partner-data',{headers});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||'No se pudo cargar el portal.');
      const next:PortalData=body.preview_safe?(()=>{
        const leads=readPreviewLeads();
        return {...body,leads,summary:{total:leads.length,confirmed:0,pending:leads.length,quoted:0}};
      })():body;
      setData(next);setIdentity(next.identity);
      if(token)setSellerToken(token);
      return body as PortalData;
    }catch(e:any){
      setError(e.message||'No se pudo cargar el portal.');
      throw e;
    }finally{setLoading(false)}
  }

  useEffect(()=>{
    const previousTitle=document.title;
    document.title='LINK Ventas · Escritorio';
    let robots=document.querySelector('meta[name="robots"]') as HTMLMetaElement|null;
    const created=!robots;
    if(!robots){robots=document.createElement('meta');robots.name='robots';document.head.appendChild(robots)}
    const previous=robots.content;
    robots.content='noindex,nofollow,noarchive,nosnippet';
    const onSessionHandoff=(event:MessageEvent)=>{
      if(event.origin!==PREVIEW_PRODUCTION_ORIGIN||event.source!==window.opener||event.data?.type!=='LINK_VENTAS_PREVIEW_SESSION')return;
      const token=String(event.data.access_token||'');
      if(!token)return;
      setHandoffWaiting(false);
      void loadData(token).then(()=>setChecking(false)).catch(()=>setChecking(false));
    };
    window.addEventListener('message',onSessionHandoff);
    void (async()=>{
      try{
        const {data:{session}}=await supabase.auth.getSession();
        if(session){
          await loadData(session.access_token);
        }else if(isPagesPreviewHost){
          if(window.opener){
            setHandoffWaiting(true);
            window.opener.postMessage({type:'LINK_VENTAS_PREVIEW_READY'},PREVIEW_PRODUCTION_ORIGIN);
          }
        }else{
          const response=await fetch('/api/partner-data?area=auth');
          if(response.ok){
            const body=await response.json();
            if(body.authenticated)await loadData();
          }
        }
      }catch(_error){
        setError('');
      }finally{
        if(!handoffWaiting)setChecking(false);
      }
    })();
    return()=>{
      window.removeEventListener('message',onSessionHandoff);
      document.title=previousTitle;
      if(created)robots?.remove();else if(robots)robots.content=previous;
    };
  },[]);

  useEffect(()=>{
    if(!data?.hotels?.length)return;
    setSelectedHotelId(current=>data.hotels.some(hotel=>hotel.id===current)?current:data.hotels[0].id);
  },[data?.hotels]);

  async function login(event:React.FormEvent){
    event.preventDefault();setLoading(true);setError('');
    try{
      if(loginMode==='seller'){
        const {data:authData,error:authError}=await supabase.auth.signInWithPassword({email:sellerEmail.trim(),password:sellerPassword});
        if(authError)throw authError;
        if(!authData.session)throw new Error('No se pudo iniciar la sesión de vendedor.');
        await loadData(authData.session.access_token);
      }else{
        const response=await fetch('/api/partner-data?area=auth',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'login',accessCode,password:partnerPassword})
        });
        const body=await response.json();
        if(!response.ok)throw new Error(body.error||'No se pudo ingresar.');
        await loadData();
        setPartnerPassword('');
      }
      setTab('catalog');
    }catch(e:any){setError(e.message||'No se pudo ingresar.')}
    finally{setLoading(false)}
  }

  async function logout(){
    if(identity?.mode==='seller'){
      await supabase.auth.signOut();
    }else{
      await fetch('/api/partner-data?area=auth',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'logout'})
      });
    }
    setIdentity(null);setData(null);setSellerToken('');setSelectedHotelId('');
    setSelectedServices([]);setNotice('');setTab('catalog');
    setSellerPassword('');setPartnerPassword('');
  }

  function addService(selection:PortalCatalogSelection){
    const item:SelectedService={...selection,key:String(Date.now())+'-'+String(Math.random()).slice(2),date:'',notes:''};
    setSelectedServices(current=>[...current,item]);
    setNotice('');
  }

  function updateService(key:string,patch:Partial<SelectedService>){
    setSelectedServices(current=>current.map(item=>item.key===key?{...item,...patch}:item));
  }

  function removeService(key:string){
    setSelectedServices(current=>current.filter(item=>item.key!==key));
  }

  async function requestCreated(code:string){
    setSelectedServices([]);
    setNotice('Solicitud '+code+' recibida. Quedó pendiente de confirmación.');
    setTab('reservations');
    try{await loadData(sellerToken||undefined)}catch(_error){setError('La solicitud quedó registrada; actualiza para consultar su estado.');}
  }

  if(checking)return <main className="partner-shell"><div className="partner-loading">Preparando Hotel Experience…</div></main>;

  if(!identity||!data)return <main className="partner-shell partner-login-page">
    <section className="partner-login">
      <div className="partner-login-copy">
        <span className="partner-eyebrow">LINK VENTAS · PRUEBA SEGURA</span>
        <h1>Usa tu sesión actual de administración.</h1>
        <p>Esta dirección de vista previa no comparte el almacenamiento de sesión con LINK Ventas. Ábrela desde la aplicación principal con el botón «Probar escritorio seguro» para transferir una sesión temporal, sin volver a escribir tu contraseña.</p>
        <div className="partner-security"><ShieldCheck size={18}/><span>No se envían tokens por URL ni se guardan en este navegador. La prueba solo consulta tu perfil bajo RLS; las solicitudes DEMO quedan locales.</span></div>
      </div>
      <div className="partner-login-card">
        <div className="partner-login-icon"><ShieldCheck size={20}/></div>
        <span className="partner-eyebrow">ACCESO CON SESIÓN EXISTENTE</span>
        <h2>{handoffWaiting?'Esperando la sesión de LINK Ventas…':'Abre la prueba desde LINK Ventas'}</h2>
        <p>{handoffWaiting?'La ventana está lista. Vuelve a LINK Ventas; la sesión se transferirá de forma directa y temporal.':'No introduzcas otra contraseña aquí. Primero entra a LINK Ventas como lo haces normalmente y usa «Probar escritorio seguro».'}</p>
        <a className="partner-primary" href={PREVIEW_PRODUCTION_ORIGIN}>Abrir LINK Ventas</a>
      </div>
    </section>
  </main>;

me={loginMode==='seller'?'active':''} onClick={()=>{setLoginMode('seller');setError('')}}><UserRound size={14}/> Vendedor</button>
          </div>
          {loginMode==='hotel'?<>
            <label><span>Código de hotel</span><input value={accessCode} onChange={e=>setAccessCode(e.target.value.toUpperCase())} placeholder="Código asignado" autoComplete="username"/></label>
            <label><span>Contraseña</span><input type="password" value={partnerPassword} onChange={e=>setPartnerPassword(e.target.value)} placeholder="Contraseña asignada" autoComplete="current-password"/></label>
          </>:<>
            <label><span>Correo de vendedor</span><input type="email" value={sellerEmail} onChange={e=>setSellerEmail(e.target.value)} placeholder="correo@ejemplo.com" autoComplete="username"/></label>
            <label><span>Contraseña</span><input type="password" value={sellerPassword} onChange={e=>setSellerPassword(e.target.value)} placeholder="Contraseña de LINK" autoComplete="current-password"/></label>
          </>}
          {error&&<div className="partner-error">{error}</div>}
          <button disabled={loading||(loginMode==='hotel'?(!accessCode.trim()||!partnerPassword):(!sellerEmail.trim()||!sellerPassword))}>{loading?'Validando…':<>Ingresar <ArrowRight size={16}/></>}</button>
          <small>Vendedores: correo y contraseña individuales. Puntos de venta: código y contraseña propios, limitados a un hotel.</small><a className="partner-back-link" href="#/">Volver a LINK Ventas</a>
        </form>
      </section>
    </main>;
  }

