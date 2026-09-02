-- LINK Ventas: completar datos del cliente y acompañantes después del ingreso inicial.

create or replace function public.update_link_sale_intake(p_lead_id uuid, p_payload jsonb)
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
  v_index integer:=0;
  v_code text;
  v_count integer:=jsonb_array_length(coalesce(p_payload->'passengers','[]'::jsonb));
begin
  v_role:=public.current_user_role();
  if v_user is null or v_role not in ('admin','manager','agent') then
    raise exception 'Not authorized to update sales intake';
  end if;

  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;

  if v_role='agent' and coalesce(v_lead.assigned_to,v_lead.created_by)<>v_user then
    raise exception 'No puedes modificar un ingreso asignado a otro vendedor';
  end if;

  update public.leads
  set contacto=nullif(p_payload->>'contact',''),
      checkin=nullif(p_payload->>'checkin','')::date,
      checkout=nullif(p_payload->>'checkout','')::date,
      nationality=nullif(p_payload->>'nationality',''),
      stay_days=coalesce(
        nullif(p_payload->>'stay_days','')::integer,
        case
          when nullif(p_payload->>'checkin','') is not null and nullif(p_payload->>'checkout','') is not null
            then greatest(0,(nullif(p_payload->>'checkout','')::date-nullif(p_payload->>'checkin','')::date))
          else null
        end
      ),
      prioridad=coalesce(nullif(p_payload->>'priority',''),'Media'),
      numero_pax=case when v_count>0 then v_count else numero_pax end,
      next_best_action=case
        when estado='confirmado' then next_best_action
        when v_count=0 then 'Completar datos de cliente'
        else next_best_action
      end,
      updated_at=now()
  where id=p_lead_id;

  for v_passenger in select value from jsonb_array_elements(coalesce(p_payload->'passengers','[]'::jsonb)) loop
    v_index:=v_index+1;
    v_code:=v_lead.codigo||'-P'||lpad(v_index::text,2,'0');

    insert into public.passengers(
      lead_id,passenger_code,full_name,email,phone,nationality,
      document_type,document_number,birth_date,dietary_restrictions,is_primary,created_by
    ) values(
      p_lead_id,
      v_code,
      coalesce(nullif(v_passenger->>'full_name',''),case when v_index=1 then 'Cliente por completar' else 'Acompañante '||v_index end),
      nullif(v_passenger->>'email',''),
      nullif(v_passenger->>'phone',''),
      coalesce(nullif(v_passenger->>'nationality',''),case when v_index=1 then nullif(p_payload->>'nationality','') else null end),
      coalesce(nullif(v_passenger->>'document_type',''),'Pasaporte'),
      nullif(v_passenger->>'document_number',''),
      nullif(v_passenger->>'birth_date','')::date,
      nullif(v_passenger->>'dietary_restrictions',''),
      v_index=1,
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

  insert into public.crm_activities(lead_id,type,title,body,created_by)
  values(p_lead_id,'sales_intake_updated','Datos comerciales actualizados',v_count||' persona(s) registradas o actualizadas.',coalesce(v_user::text,'LINK Ventas'));

  return jsonb_build_object('lead_id',p_lead_id,'passengers_updated',v_count);
end;
$$;

revoke all on function public.update_link_sale_intake(uuid,jsonb) from public;
grant execute on function public.update_link_sale_intake(uuid,jsonb) to authenticated;

comment on function public.update_link_sale_intake(uuid,jsonb) is
'Completes lead and passenger data after initial LINK sales intake without changing operational service records.';
