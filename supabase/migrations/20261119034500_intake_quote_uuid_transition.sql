begin;
CREATE OR REPLACE FUNCTION public.update_link_sale_draft(p_lead_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_lead.intake_request is not null and not exists(select 1 from public.profiles where id=v_user and is_active=true) then raise exception 'No autorizado'; end if;
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

  if v_lead.intake_request is not null then
    if v_lead.intake_request->>'currency' is distinct from 'CLP' then
      raise exception 'La moneda de la solicitud debe estar informada explícitamente como CLP. No hay conversión automática';
    end if;
    if exists(select 1 from jsonb_array_elements(p_payload->'passengers') p where nullif(p->>'id','') is null)
      or v_passenger_count<>(select count(*) from public.passengers where lead_id=p_lead_id)
      or (select count(distinct p->>'id') from jsonb_array_elements(p_payload->'passengers') p)<>v_passenger_count then
      raise exception 'Conserva los UUID de todos los pasajeros originales. Agrega personas desde Ficha 360';
    end if;
    -- Validate the locked original revision before UUID-only persistence.
    if nullif(p_payload->>'expected_updated_at','')::timestamptz is distinct from v_lead.updated_at then
      raise exception 'El expediente cambió. Recarga antes de guardar';
    end if;
    perform public.save_link_client_intake360(jsonb_build_object(
      'lead_id',p_lead_id,'expected_updated_at',(select updated_at from public.leads where id=p_lead_id),
      'hotel_partner_id',p_payload->'hotel_partner_id','seller_profile_id',p_payload->'seller_profile_id',
      'contact',p_payload->'contact','request',v_lead.intake_request,'passengers',p_payload->'passengers'));
  else
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

  end if;

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
      requiere_confirmacion,proposed_supplier_id,operation_list_template_key,tax_treatment_snapshot,tax_rate_snapshot
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
      nullif(v_product->>'operation_list_template_key',''),
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
$function$
  ;

create or replace function public.save_link_intake_quote360(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_id uuid:=nullif(p_payload->>'lead_id','')::uuid;
  v_result jsonb;
  v_row public.leads%rowtype;
begin
  if auth.uid() is null or public.current_user_role() is null or public.current_user_role() not in ('admin','manager','agent') or not exists(select 1 from public.profiles where id=auth.uid() and is_active=true) then raise exception 'No autorizado'; end if;
  -- Existing intake only. The underlying function enforces identity, role, record access,
  -- active profile, optimistic timestamps, UUID membership and unconfirmed status.
  select * into v_row from public.leads where id=v_id for update;
  if not found or v_row.intake_request is null then raise exception 'Falta la ficha parcial original'; end if;
  if exists(select 1 from public.lead_services where lead_id=v_id) then raise exception 'El expediente ya tiene servicios. Recarga y usa su flujo comercial'; end if;
  if jsonb_array_length(coalesce(p_payload->'passengers','[]'::jsonb))<>(select count(*) from public.passengers where lead_id=v_id)
    or exists(select 1 from jsonb_array_elements(p_payload->'passengers') p where nullif(p->>'id','') is null) then
    raise exception 'Conserva todos los pasajeros originales. Agrega personas desde Ficha 360';
  end if;
  v_result:=public.save_link_client_intake360(p_payload);
  update public.leads set sales_stage='data_capture',estado='cotizando',commercial_status='quoting',
    reservation_reference=nullif(btrim(p_payload->>'reservation_reference'),''),
    numero_pax=(select count(*) from public.passengers where lead_id=v_id),
    next_best_action='Completar términos de la propuesta antes de emitir cotización',updated_at=now()
    where id=v_id;
  -- No services, quotes, monetary totals, messages, payments, availability or archive writes.
  return v_result||jsonb_build_object('sales_stage','data_capture');
end $$;
revoke all on function public.save_link_intake_quote360(jsonb) from public,anon;
grant execute on function public.save_link_intake_quote360(jsonb) to authenticated;

commit;
