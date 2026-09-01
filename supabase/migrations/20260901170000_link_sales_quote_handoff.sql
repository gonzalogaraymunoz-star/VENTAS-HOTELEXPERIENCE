-- LINK Ventas: cotizacion -> confirmacion -> handoff a Operaciones, sin duplicar reservas.

alter table public.leads drop constraint if exists leads_lifecycle_stage_check;
alter table public.leads add constraint leads_lifecycle_stage_check
  check (lifecycle_stage = any (array['commercial'::text,'active'::text,'review'::text,'dormido'::text,'historical'::text]));

alter table public.lead_services drop constraint if exists lead_services_booking_status_check;
alter table public.lead_services add constraint lead_services_booking_status_check
  check (booking_status = any (array['quoted'::text,'hold'::text,'confirmed'::text,'cancelled'::text,'completed'::text,'expired'::text]));

alter table public.product_catalog add column if not exists tax_treatment text not null default 'manual';
alter table public.product_catalog add column if not exists tax_rate numeric;
do $$ begin
  alter table public.product_catalog add constraint product_catalog_tax_treatment_check
    check (tax_treatment = any (array['manual'::text,'taxable'::text,'exempt'::text]));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.product_catalog add constraint product_catalog_tax_rate_check
    check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100));
exception when duplicate_object then null; end $$;

alter table public.lead_services add column if not exists product_catalog_id uuid references public.product_catalog(id) on delete set null;
alter table public.lead_services add column if not exists proposed_supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.lead_services add column if not exists tax_treatment_snapshot text not null default 'manual';
alter table public.lead_services add column if not exists tax_rate_snapshot numeric;
create index if not exists lead_services_product_catalog_idx on public.lead_services(product_catalog_id);
create index if not exists lead_services_proposed_supplier_idx on public.lead_services(proposed_supplier_id);

alter table public.payment_movements add column if not exists payment_code text;
alter table public.service_commissions add column if not exists commission_code text;
create unique index if not exists payment_movements_payment_code_uidx on public.payment_movements(payment_code) where payment_code is not null;
create unique index if not exists service_commissions_commission_code_uidx on public.service_commissions(commission_code) where commission_code is not null;

create or replace function public.assign_link_payment_code()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_service_code text; v_number integer;
begin
  if coalesce(btrim(new.payment_code),'') <> '' or new.lead_service_id is null then return new; end if;
  perform 1 from public.lead_services where id=new.lead_service_id for update;
  select service_code into v_service_code from public.lead_services where id=new.lead_service_id;
  if coalesce(v_service_code,'')='' then return new; end if;
  select coalesce(max((regexp_match(payment_code,'-PG([0-9]+)$'))[1]::integer),0)+1 into v_number
  from public.payment_movements where lead_service_id=new.lead_service_id and payment_code ~ '-PG[0-9]+$';
  new.payment_code:=v_service_code||'-PG'||lpad(v_number::text,2,'0');
  return new;
end $$;
drop trigger if exists trg_assign_link_payment_code on public.payment_movements;
create trigger trg_assign_link_payment_code before insert on public.payment_movements
for each row execute function public.assign_link_payment_code();

create or replace function public.assign_link_commission_code()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_service_code text; v_number integer;
begin
  if coalesce(btrim(new.commission_code),'') <> '' then return new; end if;
  perform 1 from public.lead_services where id=new.lead_service_id for update;
  select service_code into v_service_code from public.lead_services where id=new.lead_service_id;
  if coalesce(v_service_code,'')='' then return new; end if;
  select coalesce(max((regexp_match(commission_code,'-CM([0-9]+)$'))[1]::integer),0)+1 into v_number
  from public.service_commissions where lead_service_id=new.lead_service_id and commission_code ~ '-CM[0-9]+$';
  new.commission_code:=v_service_code||'-CM'||lpad(v_number::text,2,'0');
  return new;
end $$;
drop trigger if exists trg_assign_link_commission_code on public.service_commissions;
create trigger trg_assign_link_commission_code before insert on public.service_commissions
for each row execute function public.assign_link_commission_code();

create or replace function public.confirm_link_sale(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_role text; v_lead public.leads%rowtype; v_service public.lead_services%rowtype;
  v_hotel_name text; v_confirmed integer:=0;
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then raise exception 'Not authorized to confirm sales'; end if;
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  select hp.name into v_hotel_name from public.hotel_partners hp where hp.id=v_lead.hotel_partner_id;
  if not exists(select 1 from public.lead_services where lead_id=p_lead_id and booking_status='quoted') then
    if exists(select 1 from public.lead_services where lead_id=p_lead_id and booking_status in ('confirmed','completed')) then
      return jsonb_build_object('lead_id',v_lead.id,'lead_code',v_lead.codigo,'already_confirmed',true);
    end if;
    raise exception 'No quoted services found for this lead';
  end if;
  if exists(select 1 from public.lead_services where lead_id=p_lead_id and booking_status='quoted' and coalesce(precio_total,precio_venta,0)<=0) then
    raise exception 'No se puede confirmar: hay productos sin precio de venta definido.';
  end if;

  for v_service in select * from public.lead_services where lead_id=p_lead_id and booking_status='quoted' order by created_at,id
  loop
    update public.lead_services set booking_status='confirmed',pricing_status='confirmed',updated_at=now() where id=v_service.id;
    v_confirmed:=v_confirmed+1;

    if v_service.proposed_supplier_id is not null and not exists(select 1 from public.service_assignments a where a.lead_service_id=v_service.id) then
      insert into public.service_assignments(lead_service_id,supplier_id,supplier_cost,supplier_payment_status,created_by,updated_by,operation_mode,notes)
      values(v_service.id,v_service.proposed_supplier_id,coalesce(v_service.costo_operador_total,0),'Pendiente',v_user,v_user,'delegated_full','Operador propuesto por LINK Ventas; Operaciones debe validar la asignación.');
    end if;

    if coalesce(v_service.comision_hotel,0)>0 and not exists(select 1 from public.service_commissions c where c.lead_service_id=v_service.id and c.actor_type='hotel') then
      insert into public.service_commissions(lead_service_id,actor_type,actor_name,percentage,amount,calculation_basis,status,notes)
      values(v_service.id,'hotel',v_hotel_name,case when coalesce(v_service.margen_comercial,0)>0 then round((v_service.comision_hotel/v_service.margen_comercial)*100,4) else null end,v_service.comision_hotel,'margin','pending','Generada al confirmar venta en LINK');
    end if;
    if coalesce(v_service.comision_vendedor,0)>0 and not exists(select 1 from public.service_commissions c where c.lead_service_id=v_service.id and c.actor_type='seller') then
      insert into public.service_commissions(lead_service_id,actor_type,actor_name,percentage,amount,calculation_basis,status,notes)
      values(v_service.id,'seller',v_service.seller_name,case when coalesce(v_service.margen_comercial,0)>0 then round((v_service.comision_vendedor/v_service.margen_comercial)*100,4) else null end,v_service.comision_vendedor,'margin','pending','Generada al confirmar venta en LINK');
    end if;
    if coalesce(v_service.margen_hotel_experience,0)>0 and not exists(select 1 from public.service_commissions c where c.lead_service_id=v_service.id and c.actor_type='platform') then
      insert into public.service_commissions(lead_service_id,actor_type,actor_name,amount,calculation_basis,status,notes)
      values(v_service.id,'platform','HOTEL EXPERIENCE / LINK',v_service.margen_hotel_experience,'margin','pending','Margen remanente al confirmar venta');
    end if;
  end loop;

  update public.leads set estado='confirmado',commercial_status='won',lifecycle_stage='active',next_best_action='Operaciones: preparar servicios confirmados',updated_at=now() where id=p_lead_id;
  insert into public.crm_activities(lead_id,type,title,body,created_by)
  values(p_lead_id,'sale_confirmed','Venta confirmada y entregada a Operaciones',v_confirmed||' servicio(s) pasaron de cotización a confirmados.',coalesce(v_user::text,'LINK Ventas'));
  return jsonb_build_object('lead_id',v_lead.id,'lead_code',v_lead.codigo,'confirmed_services',v_confirmed);
end $$;
revoke all on function public.confirm_link_sale(uuid) from public;
grant execute on function public.confirm_link_sale(uuid) to authenticated;

create or replace function public.create_link_sale(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_role text; v_lead public.leads%rowtype; v_service public.lead_services%rowtype;
  v_passenger jsonb; v_product jsonb; v_catalog public.product_catalog%rowtype;
  v_passenger_index integer:=0; v_total numeric:=0; v_service_names text[]:='{}'; v_confirm boolean:=coalesce((p_payload->>'confirm_now')::boolean,false);
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then raise exception 'Not authorized to create sales'; end if;
  if nullif(p_payload->>'hotel_partner_id','') is null then raise exception 'hotel_partner_id is required'; end if;
  if not exists(select 1 from public.hotel_partners where id=(p_payload->>'hotel_partner_id')::uuid and active=true) then raise exception 'Hotel partner not found or inactive'; end if;
  if jsonb_array_length(coalesce(p_payload->'passengers','[]'::jsonb))=0 then raise exception 'At least one passenger is required'; end if;
  if jsonb_array_length(coalesce(p_payload->'services','[]'::jsonb))=0 then raise exception 'At least one service is required'; end if;

  insert into public.leads(codigo,reserva,numero_pax,servicio,precio_venta,moneda,checkin,checkout,contacto,observaciones_cobros,propuesta_enviada,prioridad,estado,canal,created_by,assigned_to,hotel_partner_id,lifecycle_stage,commercial_status,next_best_action)
  values('PENDIENTE','PENDIENTE',jsonb_array_length(p_payload->'passengers'),'Cotización LINK',0,'CLP',nullif(p_payload->>'checkin','')::date,nullif(p_payload->>'checkout','')::date,nullif(p_payload->>'contact',''),nullif(p_payload->>'notes',''),'Pendiente',coalesce(nullif(p_payload->>'priority',''),'Media'),'cotizando',coalesce(nullif(p_payload->>'channel',''),'Venta directa'),v_user,v_user,(p_payload->>'hotel_partner_id')::uuid,'commercial','quoting','Enviar propuesta') returning * into v_lead;
  update public.leads set reserva=v_lead.codigo where id=v_lead.id; v_lead.reserva:=v_lead.codigo;

  for v_passenger in select value from jsonb_array_elements(p_payload->'passengers') loop
    v_passenger_index:=v_passenger_index+1;
    insert into public.passengers(lead_id,passenger_code,full_name,email,phone,nationality,document_type,document_number,birth_date,dietary_restrictions,is_primary,created_by)
    values(v_lead.id,v_lead.codigo||'-P'||lpad(v_passenger_index::text,2,'0'),coalesce(nullif(v_passenger->>'full_name',''),'Pasajero '||v_passenger_index),nullif(v_passenger->>'email',''),nullif(v_passenger->>'phone',''),nullif(v_passenger->>'nationality',''),nullif(v_passenger->>'document_type',''),nullif(v_passenger->>'document_number',''),nullif(v_passenger->>'birth_date','')::date,nullif(v_passenger->>'dietary_restrictions',''),case when v_passenger_index=1 then true else coalesce((v_passenger->>'is_primary')::boolean,false) end,v_user);
  end loop;

  for v_product in select value from jsonb_array_elements(p_payload->'services') loop
    if nullif(v_product->>'product_id','') is null then raise exception 'Todos los servicios deben provenir del product_catalog'; end if;
    select * into v_catalog from public.product_catalog where id=(v_product->>'product_id')::uuid and active=true;
    if not found then raise exception 'Producto de catálogo no encontrado o inactivo'; end if;
    if v_confirm and coalesce((v_product->>'total_price')::numeric,0)<=0 then raise exception 'No se puede confirmar un producto sin precio de venta'; end if;

    insert into public.lead_services(lead_id,product_catalog_id,producto,fecha_servicio,numero_pax,observacion,precio_venta,moneda,estado_pago,estado_operacion,tour_id,modality,pricing_status,price_pp_clp,pricing_source,service_type,seller_name,costo_operador_total,booking_status,sales_channel,hora_inicio,precio_unitario,precio_total,margen_comercial,comision_hotel,comision_vendedor,margen_hotel_experience,horario_confirmado,requiere_confirmacion,proposed_supplier_id,tax_treatment_snapshot,tax_rate_snapshot)
    values(v_lead.id,v_catalog.id,v_catalog.name,nullif(v_product->>'date','')::date,coalesce((v_product->>'pax')::integer,1),nullif(v_product->>'notes',''),coalesce((v_product->>'total_price')::numeric,0),'CLP','Pendiente','Pendiente',v_catalog.code,nullif(v_product->>'modality',''),'quoted',nullif(v_product->>'unit_price','')::numeric,'LINK Ventas / product_catalog',v_catalog.category,nullif(p_payload->>'seller_name',''),coalesce((v_product->>'operator_cost')::numeric,0),'quoted',coalesce(nullif(p_payload->>'channel',''),'Venta directa'),nullif(v_product->>'start_time','')::time,nullif(v_product->>'unit_price','')::numeric,coalesce((v_product->>'total_price')::numeric,0),coalesce((v_product->>'margin')::numeric,0),coalesce((v_product->>'hotel_commission')::numeric,0),coalesce((v_product->>'seller_commission')::numeric,0),coalesce((v_product->>'platform_margin')::numeric,0),case when nullif(v_product->>'start_time','') is null then false else true end,case when nullif(v_product->>'start_time','') is null then true else false end,nullif(v_product->>'supplier_id','')::uuid,coalesce(v_catalog.tax_treatment,'manual'),v_catalog.tax_rate) returning * into v_service;
    v_total:=v_total+coalesce(v_service.precio_total,v_service.precio_venta,0);
    v_service_names:=array_append(v_service_names,v_service.producto);
  end loop;

  update public.leads set servicio=array_to_string(v_service_names,' + '),precio_venta=v_total,numero_pax=jsonb_array_length(p_payload->'passengers'),updated_at=now() where id=v_lead.id;
  insert into public.crm_activities(lead_id,type,title,body,created_by)
  values(v_lead.id,'quote_created','Cotización creada',array_length(v_service_names,1)||' servicio(s) registrados como cotización.',coalesce(v_user::text,'LINK Ventas'));

  if v_confirm then perform public.confirm_link_sale(v_lead.id); end if;
  return jsonb_build_object('lead_id',v_lead.id,'lead_code',v_lead.codigo,'reservation_code',v_lead.codigo,'status',case when v_confirm then 'confirmed' else 'quoted' end);
end $$;
revoke all on function public.create_link_sale(jsonb) from public;
grant execute on function public.create_link_sale(jsonb) to authenticated;

comment on function public.create_link_sale(jsonb) is 'LINK Ventas: crea cotización estructurada sobre leads/passengers/lead_services y opcionalmente la confirma sin duplicar la reserva.';
comment on function public.confirm_link_sale(uuid) is 'LINK Ventas: convierte los mismos lead_services cotizados en confirmados y habilita el handoff a HOTEL EXPERIENCE Operaciones.';
