-- LINK Ventas: un solo registro comercial evoluciona desde ingreso de información a reserva confirmada.
-- La confirmación no crea una segunda reserva: cambia el estado de los mismos servicios y los entrega a Operaciones.

create or replace function public.update_link_sale_draft(p_lead_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_lead public.leads%rowtype;
  v_passenger jsonb;
  v_product jsonb;
  v_catalog public.product_catalog%rowtype;
  v_service public.lead_services%rowtype;
  v_passenger_index integer:=0;
  v_passenger_count integer:=jsonb_array_length(coalesce(p_payload->'passengers','[]'::jsonb));
  v_service_count integer:=jsonb_array_length(coalesce(p_payload->'services','[]'::jsonb));
  v_total numeric:=0;
  v_service_names text[]:='{}';
  v_seller uuid;
  v_seller_name text;
  v_catalog_id uuid;
  v_product_name text;
  v_product_code text;
  v_category text;
  v_tax_treatment text;
  v_tax_rate numeric;
  v_pricing_source text;
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then
    raise exception 'Not authorized to update sales drafts';
  end if;

  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  if v_lead.estado='confirmado' or exists(select 1 from public.lead_services where lead_id=p_lead_id and booking_status in ('confirmed','completed')) then
    raise exception 'La reserva ya fue confirmada y está en Operaciones.';
  end if;
  if v_role='agent' and coalesce(v_lead.assigned_to,v_lead.created_by)<>v_user then
    raise exception 'No puedes modificar un ingreso asignado a otro vendedor';
  end if;
  if nullif(p_payload->>'hotel_partner_id','') is null then raise exception 'hotel_partner_id is required'; end if;
  if not exists(select 1 from public.hotel_partners where id=(p_payload->>'hotel_partner_id')::uuid and active=true) then
    raise exception 'Hotel partner not found or inactive';
  end if;

  v_seller:=coalesce(nullif(p_payload->>'seller_profile_id','')::uuid,v_lead.assigned_to,v_user);
  select coalesce(full_name,email) into v_seller_name
  from public.profiles
  where id=v_seller and is_active=true and role in ('admin','manager','agent');
  if v_seller_name is null then raise exception 'Selecciona un vendedor válido'; end if;
  if v_role='agent' and v_seller<>v_user then raise exception 'Un vendedor no puede asignar el ingreso a otra persona'; end if;

  update public.leads
  set hotel_partner_id=(p_payload->>'hotel_partner_id')::uuid,
      canal=coalesce(nullif(p_payload->>'channel',''),'Venta directa'),
      prioridad=coalesce(nullif(p_payload->>'priority',''),'Media'),
      checkin=nullif(p_payload->>'checkin','')::date,
      checkout=nullif(p_payload->>'checkout','')::date,
      contacto=nullif(p_payload->>'contact',''),
      nationality=nullif(p_payload->>'nationality',''),
      stay_days=coalesce(
        nullif(p_payload->>'stay_days','')::integer,
        case when nullif(p_payload->>'checkin','') is not null and nullif(p_payload->>'checkout','') is not null
          then greatest(0,(nullif(p_payload->>'checkout','')::date-nullif(p_payload->>'checkin','')::date)) else null end
      ),
      observaciones_cobros=nullif(p_payload->>'notes',''),
      assigned_to=v_seller,
      estado='cotizando',
      commercial_status='quoting',
      lifecycle_stage='commercial',
      next_best_action='Completar información y confirmar reserva',
      updated_at=now()
  where id=p_lead_id;

  for v_passenger in select value from jsonb_array_elements(coalesce(p_payload->'passengers','[]'::jsonb)) loop
    v_passenger_index:=v_passenger_index+1;
    insert into public.passengers(
      lead_id,passenger_code,full_name,email,phone,nationality,
      document_type,document_number,birth_date,dietary_restrictions,is_primary,created_by
    ) values(
      p_lead_id,
      v_lead.codigo||'-P'||lpad(v_passenger_index::text,2,'0'),
      coalesce(nullif(v_passenger->>'full_name',''),case when v_passenger_index=1 then 'Cliente por completar' else 'Acompañante '||v_passenger_index end),
      nullif(v_passenger->>'email',''),
      nullif(v_passenger->>'phone',''),
      coalesce(nullif(v_passenger->>'nationality',''),case when v_passenger_index=1 then nullif(p_payload->>'nationality','') else null end),
      coalesce(nullif(v_passenger->>'document_type',''),'Pasaporte'),
      nullif(v_passenger->>'document_number',''),
      nullif(v_passenger->>'birth_date','')::date,
      nullif(v_passenger->>'dietary_restrictions',''),
      v_passenger_index=1,
      v_user
    )
    on conflict (passenger_code) do update set
      full_name=excluded.full_name,
      email=excluded.email,
      phone=excluded.phone,
      nationality=excluded.nationality,
      document_type=excluded.document_type,
      document_number=excluded.document_number,
      birth_date=excluded.birth_date,
      dietary_restrictions=excluded.dietary_restrictions,
      is_primary=excluded.is_primary,
      updated_at=now();
  end loop;

  if v_passenger_count=0 then
    insert into public.passengers(lead_id,passenger_code,full_name,document_type,is_primary,created_by)
    values(p_lead_id,v_lead.codigo||'-P01','Cliente por completar','Pasaporte',true,v_user)
    on conflict(passenger_code) do nothing;
    v_passenger_count:=1;
  end if;

  delete from public.passengers p
  where p.lead_id=p_lead_id
    and p.passenger_code like v_lead.codigo||'-P%'
    and p.passenger_code not in (
      select v_lead.codigo||'-P'||lpad(gs::text,2,'0')
      from generate_series(1,v_passenger_count) gs
    );

  delete from public.lead_services where lead_id=p_lead_id and booking_status='quoted';

  for v_product in select value from jsonb_array_elements(coalesce(p_payload->'services','[]'::jsonb)) loop
    v_catalog_id:=null;
    v_product_name:=null;
    v_product_code:=null;
    v_category:=null;
    v_tax_treatment:='manual';
    v_tax_rate:=null;
    v_pricing_source:='LINK Ventas / manual';

    if nullif(v_product->>'product_id','') is not null then
      select * into v_catalog from public.product_catalog
      where id=(v_product->>'product_id')::uuid and active=true;
      if not found then raise exception 'Producto de catálogo no encontrado o inactivo'; end if;
      v_catalog_id:=v_catalog.id;
      v_product_name:=v_catalog.name;
      v_product_code:=v_catalog.code;
      v_category:=v_catalog.category;
      v_tax_treatment:=coalesce(v_catalog.tax_treatment,'manual');
      v_tax_rate:=v_catalog.tax_rate;
      v_pricing_source:='LINK Ventas / product_catalog';
    else
      v_product_name:=coalesce(nullif(v_product->>'product_name',''),'Ítem manual');
      v_product_code:=coalesce(nullif(v_product->>'product_code',''),'MANUAL');
      v_category:=coalesce(nullif(v_product->>'category',''),'Manual');
    end if;

    insert into public.lead_services(
      lead_id,product_catalog_id,producto,fecha_servicio,numero_pax,observacion,
      precio_venta,moneda,estado_pago,estado_operacion,tour_id,modality,
      pricing_status,price_pp_clp,pricing_source,service_type,seller_name,
      costo_operador_total,booking_status,sales_channel,hora_inicio,
      precio_unitario,precio_total,margen_comercial,comision_hotel,
      comision_vendedor,margen_hotel_experience,horario_confirmado,
      requiere_confirmacion,proposed_supplier_id,tax_treatment_snapshot,tax_rate_snapshot
    ) values(
      p_lead_id,v_catalog_id,v_product_name,nullif(v_product->>'date','')::date,
      coalesce((v_product->>'pax')::integer,1),nullif(v_product->>'notes',''),
      coalesce((v_product->>'total_price')::numeric,0),'CLP','Pendiente','Pendiente',
      v_product_code,nullif(v_product->>'modality',''),'quoted',
      nullif(v_product->>'unit_price','')::numeric,v_pricing_source,v_category,v_seller_name,
      coalesce((v_product->>'operator_cost')::numeric,0),'quoted',
      coalesce(nullif(p_payload->>'channel',''),'Venta directa'),
      nullif(v_product->>'start_time','')::time,
      nullif(v_product->>'unit_price','')::numeric,
      coalesce((v_product->>'total_price')::numeric,0),
      coalesce((v_product->>'margin')::numeric,0),
      coalesce((v_product->>'hotel_commission')::numeric,0),
      coalesce((v_product->>'seller_commission')::numeric,0),
      coalesce((v_product->>'platform_margin')::numeric,0),
      case when nullif(v_product->>'start_time','') is null then false else true end,
      case when nullif(v_product->>'start_time','') is null then true else false end,
      nullif(v_product->>'supplier_id','')::uuid,
      v_tax_treatment,v_tax_rate
    ) returning * into v_service;

    v_total:=v_total+coalesce(v_service.precio_total,v_service.precio_venta,0);
    v_service_names:=array_append(v_service_names,v_service.producto);
  end loop;

  update public.leads
  set servicio=case when v_service_count=0 then 'Sin producto definido' else array_to_string(v_service_names,' + ') end,
      precio_venta=v_total,
      numero_pax=greatest(1,v_passenger_count),
      updated_at=now()
  where id=p_lead_id;

  insert into public.crm_activities(lead_id,type,title,body,created_by)
  values(p_lead_id,'sales_draft_updated','Ingreso de información actualizado',v_service_count||' producto(s) en borrador.',coalesce(v_user::text,'LINK Ventas'));

  return jsonb_build_object(
    'lead_id',p_lead_id,
    'lead_code',v_lead.codigo,
    'services_updated',v_service_count,
    'passengers_updated',v_passenger_count
  );
end;
$$;

revoke all on function public.update_link_sale_draft(uuid,jsonb) from public;
grant execute on function public.update_link_sale_draft(uuid,jsonb) to authenticated;

create or replace function public.confirm_link_sale(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_lead public.leads%rowtype;
  v_service public.lead_services%rowtype;
  v_primary public.passengers%rowtype;
  v_hotel_name text;
  v_confirmed integer:=0;
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then raise exception 'Not authorized to confirm sales'; end if;
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;

  if exists(select 1 from public.lead_services where lead_id=p_lead_id and booking_status in ('confirmed','completed'))
     and not exists(select 1 from public.lead_services where lead_id=p_lead_id and booking_status='quoted') then
    return jsonb_build_object('lead_id',v_lead.id,'lead_code',v_lead.codigo,'already_confirmed',true);
  end if;

  select * into v_primary from public.passengers where lead_id=p_lead_id order by is_primary desc,passenger_code asc limit 1;
  if v_lead.hotel_partner_id is null then raise exception 'No se puede confirmar: falta hotel / origen.'; end if;
  if v_lead.assigned_to is null then raise exception 'No se puede confirmar: falta vendedor responsable.'; end if;
  if v_primary.id is null or nullif(trim(v_primary.full_name),'') is null or lower(trim(v_primary.full_name)) in ('cliente por completar','por completar') then
    raise exception 'No se puede confirmar: falta el nombre del cliente.';
  end if;
  if nullif(trim(coalesce(v_lead.contacto,'')),'') is null
     and nullif(trim(coalesce(v_primary.email,'')),'') is null
     and nullif(trim(coalesce(v_primary.phone,'')),'') is null then
    raise exception 'No se puede confirmar: falta teléfono o email del cliente.';
  end if;
  if v_lead.checkin is null then raise exception 'No se puede confirmar: falta fecha de arribo.'; end if;
  if v_lead.checkout is null then raise exception 'No se puede confirmar: falta fecha de salida.'; end if;
  if v_lead.checkout < v_lead.checkin then raise exception 'No se puede confirmar: la fecha de salida debe ser posterior al arribo.'; end if;
  if not exists(select 1 from public.lead_services where lead_id=p_lead_id and booking_status='quoted') then
    raise exception 'No se puede confirmar: agrega al menos un producto.';
  end if;
  if exists(
    select 1 from public.lead_services
    where lead_id=p_lead_id and booking_status='quoted'
      and (nullif(trim(producto),'') is null or fecha_servicio is null or coalesce(numero_pax,0)<=0 or coalesce(precio_total,precio_venta,0)<=0)
  ) then
    raise exception 'No se puede confirmar: completa nombre, fecha, cantidad y precio de todos los productos.';
  end if;

  select hp.name into v_hotel_name from public.hotel_partners hp where hp.id=v_lead.hotel_partner_id;

  for v_service in select * from public.lead_services where lead_id=p_lead_id and booking_status='quoted' order by created_at,id
  loop
    update public.lead_services
    set booking_status='confirmed',pricing_status='confirmed',updated_at=now()
    where id=v_service.id;
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

  update public.leads
  set estado='confirmado',commercial_status='won',lifecycle_stage='active',
      next_best_action='Operaciones: preparar servicios confirmados',updated_at=now()
  where id=p_lead_id;

  insert into public.crm_activities(lead_id,type,title,body,created_by)
  values(p_lead_id,'reservation_confirmed','Reserva confirmada y entregada a Operaciones',v_confirmed||' servicio(s) confirmados sobre el mismo registro comercial.',coalesce(v_user::text,'LINK Ventas'));

  return jsonb_build_object('lead_id',v_lead.id,'lead_code',v_lead.codigo,'confirmed_services',v_confirmed);
end;
$$;

revoke all on function public.confirm_link_sale(uuid) from public;
grant execute on function public.confirm_link_sale(uuid) to authenticated;

comment on function public.update_link_sale_draft(uuid,jsonb) is
'Updates the existing unconfirmed LINK sales record, including passengers and quoted services, without creating a second reservation.';
comment on function public.confirm_link_sale(uuid) is
'Final reservation gate: validates operational essentials, then confirms the same service records for Operations.';
