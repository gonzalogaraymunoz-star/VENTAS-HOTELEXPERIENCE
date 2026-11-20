import React,{useEffect,useMemo,useState} from 'react';
import './SellerDeskCatalog.css';
import {Calculator,Clock3,MapPinned,Search,Users,Layers3,BusFront,Sparkles} from 'lucide-react';
import {internalBase,priceModeLabel,salePriceFor,totalPriceFor,type CatalogProduct} from '../lib/portalPricing';
import {categoryLabel,modalityInternalLabel,modalityLabel,pricingFamilies,resolveFamilyPrice,type TourModality} from '../lib/portalTvPricing';

const MODS:TourModality[]=['low','semiprivado','privado'];
const PAX=Array.from({length:12},(_,i)=>i+1);

export type PortalCatalogSelection = {
  kind:'tour'|'extra';
  product_name:string;
  product_id?:string;
  product_code?:string;
  category:string;
  tour_id?:string;
  family_id?:string;
  modality?:TourModality;
  pax:number;
  pricing_status:'quoted'|'manual_quote';
  price_pp_clp:number|null;
  unit_price_clp:number|null;
  total_price_clp:number|null;
  price_unit:'por persona'|'por traslado'|'por servicio';
  pricing_source:string;
};

export default function ProductCatalogView({role,onSelect,publicMode=false,extraProducts}:{role:string;onSelect?:(selection:PortalCatalogSelection)=>void;publicMode?:boolean;extraProducts?:CatalogProduct[]}){
  const [mode,setMode]=useState<'tours'|'extras'>('tours');
  const [q,setQ]=useState('');
  const [category,setCategory]=useState('Todos');
  const [selectedId,setSelectedId]=useState(pricingFamilies[0]?.id||'');
  const [pax,setPax]=useState(2);
  const [extras,setExtras]=useState<CatalogProduct[]>([]);
  const [extrasLoading,setExtrasLoading]=useState(false);

  useEffect(()=>{
    setExtras(extraProducts||[]);
    setExtrasLoading(false);
  },[extraProducts]);

  const categories=useMemo(()=>['Todos',...Array.from(new Set(pricingFamilies.map(x=>categoryLabel(x.category))))],[]);
  const filtered=useMemo(()=>pricingFamilies.filter(f=>{
    const hay=[f.name,...f.aliases,categoryLabel(f.category),f.origin,f.stops_or_observations].join(' ').toLowerCase();
    return (category==='Todos'||categoryLabel(f.category)===category)&&hay.includes(q.toLowerCase().trim());
  }),[q,category]);
  const selected=pricingFamilies.find(x=>x.id===selectedId)||filtered[0]||pricingFamilies[0]||null;

  return <div className="view-stack pricing-v6">
    <section className="catalog-hero pricing-hero">
      <div><span className="eyebrow">{publicMode?'HOTEL EXPERIENCE · CATÁLOGO':'CATÁLOGO COMERCIAL'}</span><h2>{publicMode?'Experiencias, alternativas y tarifas.':'Productos, modalidades y precios.'}</h2><p>{publicMode?'Consulta las variantes y sus tramos. Las tarifas orientan la solicitud; toda disponibilidad queda pendiente de confirmación.':'Los tours se estandarizan con TV1.2 por tour_id → modalidad → pax. Transporte, wellness y otros servicios conservan el catálogo complementario de Supabase.'}</p></div>
      <div className="pricing-meta"><span>Fuente tours</span><strong>TV1.2 Fauna Experiencias</strong><small>33 tours · CLP · sin correcciones manuales</small></div>
    </section>

    <div className="catalog-mode-tabs">
      <button className={mode==='tours'?'active':''} onClick={()=>setMode('tours')}><Layers3 size={15}/> Tours TV1.2</button>
      <button className={mode==='extras'?'active':''} onClick={()=>setMode('extras')}><BusFront size={15}/> Transporte & otros servicios</button>
    </div>

    {mode==='tours'?<section className="pricing-workspace">
      <aside className="pricing-browser">
        <div className="pricing-search"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar experiencia…"/></div>
        <select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select>
        <div className="pricing-product-list">
          {filtered.map(f=><button key={f.id} className={selected?.id===f.id?'active':''} onClick={()=>setSelectedId(f.id)}>
            <span><strong>{f.name}</strong><small>{categoryLabel(f.category)}</small></span>
            <em>{MODS.filter(m=>f.modalities[m]?.tariff_found).length}/3</em>
          </button>)}
          {!filtered.length&&<div className="empty-card">No hay productos para este filtro.</div>}
        </div>
      </aside>

      {selected&&<section className="pricing-detail-v6">
        <header className="pricing-product-head">
          <div><span className="eyebrow">{categoryLabel(selected.category)}</span><h2>{selected.name}</h2><p>{selected.stops_or_observations||'Sin descripción operacional.'}</p></div>
          <div className="product-facts">
            <span><Clock3 size={14}/>{durationText(selected.duration)}</span>
            <span><MapPinned size={14}/>{scheduleText(selected.schedule)}</span>
          </div>
        </header>

        <div className="pax-quote-control">
          <div><Calculator size={18}/><span><b>Cotizar tramo</b><small>Selecciona pasajeros para comparar Compartido, Semiprivado y Privado.</small></span></div>
          <div className="pax-stepper">
            <button onClick={()=>setPax(Math.max(1,pax-1))}>−</button><strong>{pax}</strong><span>pax</span><button onClick={()=>setPax(Math.min(12,pax+1))}>+</button>
          </div>
        </div>

        <div className="modality-comparison">
          {MODS.map(m=>{
            const quote=resolveFamilyPrice(selected,m,pax);
            const source=selected.modalitySources[m]||selected.id;
            return <article className={`modality-price-card ${quote.status}`} key={m}>
              <div className="modality-card-head"><span><b>{modalityLabel(m)}</b>{!publicMode&&<small>{modalityInternalLabel(m)}</small>}</span><i>{statusLabel(quote.status)}</i></div>
              {quote.status==='quoted'?<>
                <strong className="modality-main-price">{money(quote.price_pp_clp)} <small>p/p</small></strong>
                <div className="modality-total"><span>Total {pax} pax</span><b>{money(quote.group_total_clp)}</b></div>
              </>:<div className="manual-price">{quote.status==='manual_quote'?'Cotización manual':'No disponible'}</div>}
              {quote.status!=='not_available'&&<div className="modality-conditions">
                {selected.modalities[m]?.duration?.display&&<small>Duración: {selected.modalities[m].duration.display} h</small>}
                {selected.modalities[m]?.schedule&&<small>Horario: {selected.modalities[m].schedule}</small>}
                {selected.modalities[m]?.food&&<small>Incluye: {selected.modalities[m].food}</small>}
                {selected.modalities[m]?.entrance?.included_in_price===true&&<small>Entrada incluida en el precio</small>}
                {selected.modalities[m]?.entrance?.included_in_price===false&&<small>Entrada no incluida</small>}
                {selected.modalities[m]?.entrance?.included_in_price==null&&selected.modalities[m]?.entrance?.source_text&&<small>{selected.modalities[m].entrance.source_text}</small>}
                {Number(selected.modalities[m]?.entrance?.value_pp_clp||0)>0&&<small>Entrada: {money(selected.modalities[m].entrance.value_pp_clp)} por persona</small>}
              </div>}
              <footer>{publicMode?<span>{selected.modalities[m]?.declared_available===false&&selected.modalities[m]?.tariff_found?'Tarifa registrada · disponibilidad por validar':quote.status==='manual_quote'?'Condición por cotizar':'Tarifa TV1.2'}</span>:<><span>tour_id</span><code>{source}</code></>}</footer>
              {onSelect&&quote.status!=='not_available'&&<button type="button" className="primary-button" onClick={()=>onSelect({
                kind:'tour',product_name:selected.name,category:selected.category,tour_id:source,family_id:selected.id,modality:m,pax,
                pricing_status:quote.status==='quoted'?'quoted':'manual_quote',price_pp_clp:quote.price_pp_clp,unit_price_clp:quote.price_pp_clp,
                total_price_clp:quote.group_total_clp,price_unit:'por persona',pricing_source:'TV1.2 Fauna Experiencias'
              })}>Agregar a solicitud</button>}
            </article>
          })}
        </div>

        <div className="pricing-matrix-card">
          <div className="pricing-matrix-head"><div><Layers3 size={17}/><span><b>Tramos completos</b><small>Precio por persona y total del grupo.</small></span></div><span className="mode-chip">1–12 PAX</span></div>
          <div className="pricing-matrix-scroll">
            <table className="pricing-matrix">
              <thead><tr><th>Pax</th>{MODS.map(m=><th key={m}>{modalityLabel(m)}{!publicMode&&<small>{modalityInternalLabel(m)}</small>}</th>)}</tr></thead>
              <tbody>{PAX.map(n=><tr className={n===pax?'selected-row':''} key={n} onClick={()=>setPax(n)}>
                <td><b>{n}</b></td>
                {MODS.map(m=><td key={m}><PriceCell quote={resolveFamilyPrice(selected,m,n)}/></td>)}
              </tr>)}</tbody>
            </table>
          </div>
        </div>

        <div className="pricing-source-note"><Users size={15}/><span>Compartido se calcula por persona. Semiprivado conserva su condición base de 2 pasajeros y su rango 2–10; 1 pasajero requiere cotización manual. Privado utiliza el tramo exacto; un tramo sin tarifa nunca se inventa.</span></div>
      </section>}
    </section>:<ExtrasCatalog products={extras} loading={extrasLoading} role={role} pax={pax} setPax={setPax} onSelect={onSelect} publicMode={publicMode}/>}    
  </div>
}

function ExtrasCatalog({products,loading,role,pax,setPax,onSelect,publicMode}:{products:CatalogProduct[];loading:boolean;role:string;pax:number;setPax:(n:number)=>void;onSelect?: (selection:PortalCatalogSelection)=>void;publicMode:boolean}){
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('Todos');
  const cats=['Todos',...Array.from(new Set(products.map(p=>p.category)))];
  const filtered=products.filter(p=>(category==='Todos'||p.category===category)&&[p.name,p.category,p.origin,p.code].join(' ').toLowerCase().includes(search.toLowerCase().trim()));
  const privileged=role==='admin'||role==='manager';
  return <section className="extras-catalog">
    <div className="extras-toolbar">
      <div className="pricing-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar transporte, wellness…"/></div>
      <select value={category} onChange={e=>setCategory(e.target.value)}>{cats.map(c=><option key={c}>{c}</option>)}</select>
      <div className="pax-stepper small"><button onClick={()=>setPax(Math.max(1,pax-1))}>−</button><strong>{pax}</strong><span>pax</span><button onClick={()=>setPax(Math.min(20,pax+1))}>+</button></div>
    </div>
    {loading?<div className="loading-card">Cargando catálogo complementario…</div>:<div className="extras-grid">
      {filtered.map(p=>{const sale=salePriceFor(p,pax);const total=totalPriceFor(p,pax);const base=internalBase(p);return <article className="extra-product-card" key={p.id}>
        <div className="extra-product-head"><span className="mode-chip">{p.category}</span>{!publicMode&&<small>{p.code}</small>}</div>
        <h3>{p.name}</h3>
        <p>{p.description||p.stops||p.schedule||'Servicio complementario.'}</p>
        <div className="extra-price"><span>{publicMode?(p.category==='Transporte'?'Traslado':sale.unit==='por persona'?'Por persona':'Por servicio'):(p.category==='Transporte'?'Traslado':priceModeLabel(p.price_mode))}</span><strong>{sale.valid?money(sale.price):'Validar tarifa'}</strong><small>{sale.valid?(p.public_unit||(p.category==='Transporte'&&p.price_mode==='lowcost_transport'?'por traslado':sale.unit)):'Sin tarifa automática'}{sale.valid&&total?' · Total '+money(total):''}</small></div>
        {privileged&&!publicMode&&base>0&&<div className="internal-reference"><Sparkles size={13}/><span>Base interna</span><b>{money(base)}</b></div>}
        {onSelect&&<button type="button" className="primary-button" onClick={()=>onSelect({
          kind:'extra',product_name:p.name,product_id:p.id,product_code:p.code,category:p.category,pax,
          pricing_status:sale.valid?'quoted':'manual_quote',price_pp_clp:sale.valid&&sale.unit==='por persona'?sale.price:null,
          unit_price_clp:sale.valid?sale.price:null,total_price_clp:sale.valid?total:null,
          price_unit:p.public_unit||(p.category==='Transporte'&&p.price_mode==='lowcost_transport'?'por traslado':sale.valid&&sale.unit==='por persona'?'por persona':p.category==='Transporte'?'por traslado':'por servicio'),
          pricing_source:'product_catalog'
        })}>Agregar a solicitud</button>}
      </article>})}
      {!filtered.length&&<div className="empty-card">No hay productos complementarios para este filtro.</div>}
    </div>}
  </section>
}

function PriceCell({quote}:{quote:any}){
  if(quote.status==='not_available')return <span className="matrix-na">—</span>;
  if(quote.status==='manual_quote')return <span className="matrix-manual">Cotizar</span>;
  return <div className="matrix-price"><b>{money(quote.price_pp_clp)}</b><small>Total {money(quote.group_total_clp)}</small></div>;
}
function money(n:any){return n==null?'—':new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(Number(n))}
function statusLabel(s:string){return s==='quoted'?'Tarifa encontrada':s==='manual_quote'?'Manual':'No disponible'}
function durationText(d:any){if(d?.hours)return `${d.hours} h`;if(d?.hours_min)return `${d.hours_min}–${d.hours_max} h`;return d?.display?`${d.display} h`:'Duración por validar'}
function scheduleText(s:any){return s?.approx||s?.block||'Horario por definir'}
