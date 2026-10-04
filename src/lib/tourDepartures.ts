import {supabase} from './supabase';
import type {SellableTourDeparture} from '../types';

export async function loadSellableTourDepartures(from:string,to:string){
  const {data,error}=await supabase.rpc('list_sellable_tour_departures',{p_from:from,p_to:to});
  if(error)throw error;
  const departures=(data||[]) as SellableTourDeparture[];
  const ids=departures.map(row=>row.departure_id).filter(Boolean);
  if(!ids.length)return departures;

  const {data:links,error:linksError}=await supabase
    .from('lead_services')
    .select('departure_id,lead_id,booking_status,leads(codigo,reserva,reservation_reference)')
    .in('departure_id',ids)
    .in('booking_status',['confirmed','completed']);
  if(linksError)throw linksError;

  const refs=new Map<string,{references:string[];codes:string[]}>();
  for(const row of links||[]){
    const departureId=String((row as any).departure_id||'');
    if(!departureId)continue;
    const lead=Array.isArray((row as any).leads)?(row as any).leads[0]:(row as any).leads;
    const human=String(lead?.reservation_reference||lead?.reserva||lead?.codigo||'').trim();
    const code=String(lead?.codigo||'').trim();
    const current=refs.get(departureId)||{references:[],codes:[]};
    if(human&&!current.references.includes(human))current.references.push(human);
    if(code&&!current.codes.includes(code))current.codes.push(code);
    refs.set(departureId,current);
  }

  return departures.map(row=>{
    const linked=refs.get(row.departure_id)||{references:[],codes:[]};
    return {...row,reservation_references:linked.references,reservation_codes:linked.codes};
  });
}

export async function addSalesTourNote(departureId:string,note:string){
  const value=note.trim();
  if(!value)throw new Error('Escribe una nota para Operaciones.');
  const {error}=await supabase.from('tour_departure_notes').insert({departure_id:departureId,source:'sales',note:value});
  if(error)throw error;
}
