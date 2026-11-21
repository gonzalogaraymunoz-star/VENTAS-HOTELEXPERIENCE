import source from '../data/tv1_2_crm_cotizador_tours.json';

export type TourModality = 'low'|'semiprivado'|'privado';

export type PriceQuote = {
  status:'quoted'|'manual_quote'|'not_available';
  modality:TourModality;
  sourceTourId:string;
  price_pp_clp:number|null;
  group_total_clp:number|null;
  currency:'CLP';
};

export type PricingFamily = {
  id:string;
  name:string;
  category:string;
  origin?:string;
  duration:any;
  schedule:any;
  stops_or_observations?:string;
  food_general?:string;
  aliases:string[];
  modalitySources:Partial<Record<TourModality,string>>;
  modalities:Partial<Record<TourModality,any>>;
};

const tours:any[]=(source as any).web_view?.tours||[];
const byId=new Map(tours.map(t=>[t.tour_id,t]));

function buildFamilies():PricingFamily[]{
  const absorbed=new Set<string>(['TOUR-ASTRONOMICO_PRIVADO']);
  const families:PricingFamily[]=[];

  for(const tour of tours){
    if(absorbed.has(tour.tour_id)) continue;

    if(tour.tour_id==='TOUR-ASTRONOMICO'){
      const priv=byId.get('TOUR-ASTRONOMICO_PRIVADO');
      families.push({
        id:'FAMILY-ASTRONOMICO',
        name:'Astronómico',
        category:tour.category,
        origin:tour.origin,
        duration:tour.duration,
        schedule:tour.schedule,
        stops_or_observations:tour.stops_or_observations,
        food_general:tour.food_general,
        aliases:[...(tour.aliases||[]),...(priv?.aliases||[]),'Astronómico privado'],
        modalitySources:{
          low:tour.tour_id,
          semiprivado:tour.tour_id,
          privado:priv?.tour_id
        },
        modalities:{
          low:tour.modalities?.low,
          semiprivado:tour.modalities?.semiprivado,
          privado:priv?.modalities?.privado
        }
      });
      continue;
    }

    const modalitySources:Partial<Record<TourModality,string>>={};
    const modalities:Partial<Record<TourModality,any>>={};
    (['low','semiprivado','privado'] as TourModality[]).forEach(m=>{
      const v=tour.modalities?.[m];
      if(v){
        modalitySources[m]=tour.tour_id;
        modalities[m]=v;
      }
    });
    families.push({
      id:tour.tour_id,
      name:tour.name,
      category:tour.category,
      origin:tour.origin,
      duration:tour.duration,
      schedule:tour.schedule,
      stops_or_observations:tour.stops_or_observations,
      food_general:tour.food_general,
      aliases:tour.aliases||[],
      modalitySources,
      modalities
    });
  }
  return families;
}

export const pricingFamilies:PricingFamily[]=buildFamilies();

export function categoryLabel(code:string){
  return ({
    TOUR_C_HD:'Clásicos · Media jornada',
    TOUR_C_FD:'Clásicos · Full day',
    TOUR_L_HD:'Experiencias · Media jornada',
    TOUR_L_FD:'Experiencias · Full day',
    NIGTH_L:'Astronomía / Nocturnos'
  } as Record<string,string>)[code]||code;
}

export function modalityLabel(modality:TourModality){
  return ({
    low:'Compartido',
    semiprivado:'Semiprivado',
    privado:'Privado'
  } as Record<TourModality,string>)[modality];
}

export function modalityInternalLabel(modality:TourModality){
  return modality==='low'?'Compartido · LOW':modality==='semiprivado'?'Semiprivado · TV1':'Privado · TV1';
}

export function availableModalities(family:PricingFamily):TourModality[]{
  return (['low','semiprivado','privado'] as TourModality[]).filter(m=>{
    const v=family.modalities[m];
    return Boolean(v && (v.tariff_found || v.declared_available));
  });
}

export function resolveFamilyPrice(family:PricingFamily, modality:TourModality, pax:number):PriceQuote{
  const sourceTourId=family.modalitySources[modality]||family.id;
  const v=family.modalities[modality];
  const safePax=Math.max(1,Math.floor(Number(pax)||1));

  if(!v){
    return {status:'not_available',modality,sourceTourId,price_pp_clp:null,group_total_clp:null,currency:'CLP'};
  }
  if(!v.tariff_found){
    return {
      status:v.declared_available?'manual_quote':'not_available',
      modality,sourceTourId,price_pp_clp:null,group_total_clp:null,currency:'CLP'
    };
  }

  const p=v.pricing||{};
  if(modality==='low'){
    const pp=Number(p.price_pp_clp||0);
    if(!pp)return {status:'manual_quote',modality,sourceTourId,price_pp_clp:null,group_total_clp:null,currency:'CLP'};
    return {status:'quoted',modality,sourceTourId,price_pp_clp:pp,group_total_clp:pp*safePax,currency:'CLP'};
  }

  if(modality==='semiprivado'){
    if(safePax<2||safePax>10){
      return {status:'manual_quote',modality,sourceTourId,price_pp_clp:null,group_total_clp:null,currency:'CLP'};
    }
    const pp=Number(p.price_pp_clp||0);
    if(!pp)return {status:'manual_quote',modality,sourceTourId,price_pp_clp:null,group_total_clp:null,currency:'CLP'};
    return {status:'quoted',modality,sourceTourId,price_pp_clp:pp,group_total_clp:pp*safePax,currency:'CLP'};
  }

  const tier=(p.tiers||[]).find((x:any)=>Number(x.pax)===safePax);
  if(!tier||tier.price_pp_clp==null||tier.group_total_clp==null){
    return {status:'manual_quote',modality,sourceTourId,price_pp_clp:null,group_total_clp:null,currency:'CLP'};
  }
  return {
    status:'quoted',modality,sourceTourId,
    price_pp_clp:Number(tier.price_pp_clp),
    group_total_clp:Number(tier.group_total_clp),
    currency:'CLP'
  };
}

export function familyById(id:string){
  return pricingFamilies.find(f=>f.id===id)||null;
}

export function priceTramos(family:PricingFamily,modality:TourModality){
  const v=family.modalities[modality];
  if(!v)return [];
  if(!v.tariff_found){
    return [{label:'Cotización manual',pax:null,price_pp_clp:null,group_total_clp:null,status:'manual_quote'}];
  }
  if(modality==='low'){
    return [{label:'1+ pax',pax:null,price_pp_clp:Number(v.pricing?.price_pp_clp||0)||null,group_total_clp:null,status:'quoted'}];
  }
  if(modality==='semiprivado'){
    return [
      {label:'1 pax',pax:1,price_pp_clp:null,group_total_clp:null,status:'manual_quote'},
      {label:'2–10 pax',pax:null,price_pp_clp:Number(v.pricing?.price_pp_clp||0)||null,group_total_clp:null,status:'quoted'}
    ];
  }
  return (v.pricing?.tiers||[]).map((t:any)=>({
    label:`${t.pax} pax`,
    pax:Number(t.pax),
    price_pp_clp:t.price_pp_clp==null?null:Number(t.price_pp_clp),
    group_total_clp:t.group_total_clp==null?null:Number(t.group_total_clp),
    status:t.price_pp_clp==null?'manual_quote':'quoted'
  }));
}

export const tv12Meta={
  dataset:(source as any).dataset,
  pricingLogic:(source as any).pricing_logic,
  sourceTourCount:(source as any).web_view?.tour_count||tours.length
};
