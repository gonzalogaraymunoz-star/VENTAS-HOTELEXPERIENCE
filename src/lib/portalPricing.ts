export type CatalogProduct = {
  id:string;
  code:string;
  name:string;
  category:string;
  origin?:string;
  duration_hours?:number|null;
  schedule?:string;
  stops?:string;
  entrance_fee?:number|null;
  snack?:string;
  description?:string;
  price_mode:string;
  public_unit?:'por persona'|'por traslado'|'por servicio';
  prices:Record<string,any>;
  source?:string;
  active:boolean;
};

export function salePriceFor(product:CatalogProduct,pax=1){
  const p=product.prices||{};
  if(product.price_mode==='private_per_pax'||product.price_mode==='regular_per_pax'){
    const value=Number(p[String(pax)]||0);
    return value>0?{price:value,unit:'por persona',valid:true}:{price:0,unit:'',valid:false};
  }
  if(product.price_mode==='regular_commission'){
    const value=Number(p.sale||0);
    return value>0?{price:value,unit:'por persona',valid:true}:{price:0,unit:'',valid:false};
  }
  if(product.price_mode==='hotel_fixed'||product.price_mode==='lowcost_transport'){
    const value=Number(p.hotel_sale||0);
    return value>0?{price:value,unit:'por servicio',valid:true}:{price:0,unit:'',valid:false};
  }
  return {price:0,unit:'',valid:false};
}

export function totalPriceFor(product:CatalogProduct,pax=1){
  const result=salePriceFor(product,pax);
  if(!result.valid)return 0;
  if(result.unit==='por persona')return result.price*pax;
  return result.price;
}

export function internalBase(product:CatalogProduct){
  if(product.price_mode==='regular_commission'||product.price_mode==='lowcost_transport'){
    return Number(product.prices?.base||0);
  }
  return 0;
}

export function priceModeLabel(mode:string){
  return ({
    private_per_pax:'Privado por pax',
    regular_per_pax:'Regular por pax',
    regular_commission:'Regular / comisión',
    hotel_fixed:'Venta hotel',
    lowcost_transport:'Transporte low cost'
  } as Record<string,string>)[mode]||mode;
}
