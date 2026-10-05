import {supabase} from './supabase';
import type {OperationListSite} from '../types';

export async function loadOperationListCatalog(){
  const {data,error}=await supabase
    .from('operation_list_catalog')
    .select('template_key,display_name,site_name,description,sort_order,active')
    .eq('active',true)
    .order('sort_order')
    .order('display_name');
  if(error)throw error;
  return (data||[]) as OperationListSite[];
}
