import {supabase} from './supabase';
import type {SellableTourDeparture} from '../types';

export async function loadSellableTourDepartures(from:string,to:string){
  const {data,error}=await supabase.rpc('list_sellable_tour_departures',{p_from:from,p_to:to});
  if(error)throw error;
  return (data||[]) as SellableTourDeparture[];
}

export async function addSalesTourNote(departureId:string,note:string){
  const value=note.trim();
  if(!value)throw new Error('Escribe una nota para Operaciones.');
  const {error}=await supabase.from('tour_departure_notes').insert({departure_id:departureId,source:'sales',note:value});
  if(error)throw error;
}
