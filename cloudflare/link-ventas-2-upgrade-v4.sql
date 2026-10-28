-- LINK Ventas 2 · v4 LINKRRSS connector, must be applied after link-ventas-2-upgrade-v3.sql.
-- Source: LIVE DEFINITIONS FROM LINK CONTROL CENTRAL.
-- Important: LINKRRSS imported messages stay in inbox until explicit human validation.
-- The original link_rrss_messages and conversation intelligence are referenced, not replicated as new leads.

-- link_sales_acquisition
CREATE OR REPLACE FUNCTION public.link_sales_acquisition(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
 v_uid uuid:=auth.uid(); v_b uuid; v_role text; v_inbox public.link_sales_inbox%rowtype;
 v_channel text; v_raw text; v_ref text; v_fp text; v_id uuid; v_lead uuid; v_person uuid; v_existing uuid;
 v_email text; v_phone text; v_name text; v_suggested jsonb; v_review jsonb; v_evidence jsonb;
 v_control uuid; v_product_ids uuid[]; v_item uuid; v_product_name text; v_products text[]; v_contact_name text;
 v_match_count int:=0; v_identity_exists boolean:=false; v_conflict boolean:=false; v_matches jsonb;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 IF jsonb_typeof(coalesce(p_data,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Payload inválido'; END IF;
 v_b:=nullif(p_data->>'business_id','')::uuid;
 IF v_b IS NULL THEN RAISE EXCEPTION 'Selecciona un negocio'; END IF;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Negocio no autorizado'; END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('ok',true,'requests',COALESCE((
   SELECT jsonb_agg(jsonb_build_object('id',i.id,'channel',i.channel,'external_ref',i.external_ref,'raw_message',i.raw_message,'status',i.status,
   'evidence',i.evidence,'review',i.review,'lead_id',i.lead_id,'created_at',i.created_at,'reviewed_at',i.reviewed_at) ORDER BY i.created_at DESC)
   FROM (SELECT * FROM public.link_sales_inbox WHERE business_id=v_b ORDER BY created_at DESC LIMIT 150) i),'[]'::jsonb));
 END IF;
 IF v_role='viewer' THEN RAISE EXCEPTION 'Rol de solo lectura'; END IF;
 IF p_action='receive' THEN
  v_raw:=btrim(coalesce(p_data->>'raw_message',''));
  v_channel:=left(lower(btrim(coalesce(p_data->>'channel','manual'))),45);
  v_ref:=nullif(left(btrim(coalesce(p_data->>'external_ref','')),250),'');
  IF length(v_raw) NOT BETWEEN 3 AND 12000 THEN RAISE EXCEPTION 'Introduce la solicitud original (3-12000 caracteres)'; END IF;
  IF v_channel !~ '^[a-z0-9_-]{2,45}$' THEN RAISE EXCEPTION 'Canal inválido'; END IF;
  v_fp:=md5(v_b::text||'|'||v_channel||'|'||coalesce(v_ref,lower(v_raw)));
  SELECT id INTO v_id FROM public.link_sales_inbox
   WHERE business_id=v_b AND channel=v_channel AND
   (external_ref=v_ref AND v_ref IS NOT NULL OR (fingerprint=v_fp AND received_on=CURRENT_DATE)) LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.link_sales_inbox(business_id,channel,external_ref,raw_message,fingerprint,created_by)
    VALUES(v_b,v_channel,v_ref,v_raw,v_fp,v_uid)
    ON CONFLICT (business_id,channel,fingerprint,received_on) DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN SELECT id INTO v_id FROM public.link_sales_inbox WHERE business_id=v_b AND channel=v_channel AND fingerprint=v_fp AND received_on=CURRENT_DATE LIMIT 1; END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'inbox_id',v_id,'reused',EXISTS(SELECT 1 FROM public.link_sales_inbox WHERE id=v_id AND created_by<>v_uid));
 END IF;
 IF p_action='identity_preview' THEN
  v_email:=nullif(lower(btrim(p_data->>'email')),'');
  v_phone:=private.link_phone_identity_key(p_data->>'phone');
  IF v_phone IS NOT NULL AND length(v_phone)<8 THEN v_phone:=NULL; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RETURN jsonb_build_object('ok',true,'identity_found',false,'matching_leads','[]'::jsonb,'requires_review',false); END IF;
  SELECT COUNT(DISTINCT p.id) INTO v_match_count FROM public.link_persons p
  JOIN public.link_person_leads pl ON pl.person_id=p.id AND pl.business_id=v_b
  WHERE p.status NOT IN ('merged','inactive') AND
    (v_email IS NOT NULL AND lower(btrim(p.email))=v_email OR v_phone IS NOT NULL AND private.link_phone_identity_key(p.phone)=v_phone);
  v_identity_exists:=(v_match_count>0);
  -- Only same-business leads may be disclosed. No cross-tenant person record is returned.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'name',l.full_name,'stage',l.stage,'product',l.interested_product,'created_at',l.created_at)),'[]'::jsonb)
  INTO v_matches FROM (
    SELECT id,full_name,stage,interested_product,created_at FROM public.sales_leads
    WHERE business_id=v_b AND stage NOT IN ('lost','won')
    AND (v_email IS NOT NULL AND lower(btrim(email))=v_email OR v_phone IS NOT NULL AND private.link_phone_identity_key(phone)=v_phone)
    ORDER BY created_at DESC LIMIT 8
  ) l;
  RETURN jsonb_build_object('ok',true,'identity_found',v_identity_exists,'possible_conflict',v_match_count>1,'matching_leads',v_matches,'requires_review',v_match_count>1);
 END IF;
 v_id:=nullif(p_data->>'inbox_id','')::uuid;
 IF v_id IS NULL THEN RAISE EXCEPTION 'La solicitud debe ingresar por Aduana LINK ID'; END IF;
 SELECT * INTO v_inbox FROM public.link_sales_inbox WHERE id=v_id AND business_id=v_b FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada en este negocio'; END IF;
 IF p_action='discard' THEN
   IF v_inbox.status='converted' THEN RAISE EXCEPTION 'No es posible descartar una solicitud convertida'; END IF;
   UPDATE public.link_sales_inbox SET status='discarded',updated_at=now(),reviewed_by=v_uid,reviewed_at=now()
   WHERE id=v_id;
   RETURN jsonb_build_object('ok',true,'inbox_id',v_id,'status','discarded');
 END IF;
 IF p_action<>'convert' THEN RAISE EXCEPTION 'Acción no permitida'; END IF;
 IF v_inbox.status='converted' THEN RETURN jsonb_build_object('ok',true,'inbox_id',v_id,'lead_id',v_inbox.lead_id,'already_converted',true); END IF;
 IF v_inbox.status='discarded' THEN RAISE EXCEPTION 'La solicitud ya fue descartada'; END IF;
 IF (p_data->>'review_confirmed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Revisión humana obligatoria'; END IF;
 v_name:=nullif(left(btrim(coalesce(p_data->>'full_name','')),160),'');
 v_email:=nullif(lower(left(btrim(coalesce(p_data->>'email','')),200)),'');
 v_phone:=nullif(left(btrim(coalesce(p_data->>'phone','')),80),'');
 IF v_email IS NOT NULL AND v_email !~ '^[^ @]+@[^ @]+\.[^ @]+$' THEN RAISE EXCEPTION 'Correo inválido'; END IF;
 IF v_name IS NULL AND v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'Contacto insuficiente: nombre, correo o teléfono'; END IF;
 v_review:=coalesce(p_data->'review','{}'::jsonb);
 v_evidence:=coalesce(p_data->'evidence','{}'::jsonb);
 IF jsonb_typeof(v_review)<>'object' OR jsonb_typeof(v_evidence)<>'object' THEN RAISE EXCEPTION 'Evidencias inválidas'; END IF;
 IF length(v_review::text)>15000 OR length(v_evidence::text)>15000 THEN RAISE EXCEPTION 'Evidencias demasiado extensas'; END IF;
 v_evidence:=coalesce(v_inbox.evidence,'{}'::jsonb)||jsonb_build_object('extraction',v_evidence);
 v_product_ids:=ARRAY(SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(coalesce(p_data->'product_ids','[]'::jsonb)));
 IF cardinality(v_product_ids)>20 THEN RAISE EXCEPTION 'Máximo 20 productos por solicitud'; END IF;
 FOREACH v_item IN ARRAY v_product_ids LOOP
  SELECT name INTO v_product_name FROM public.link_sales_items WHERE id=v_item AND business_id=v_b AND status='active';
  IF v_product_name IS NULL THEN RAISE EXCEPTION 'Producto no autorizado o inactivo'; END IF;
  v_products:=array_append(v_products,v_product_name);
 END LOOP;
 v_lead:=nullif(p_data->>'existing_lead_id','')::uuid;
 IF v_lead IS NOT NULL THEN
   -- Attaching evidence is allowed only when the existing lead belongs to the business AND a contact detail matches.
   IF NOT EXISTS(SELECT 1 FROM public.sales_leads l WHERE l.id=v_lead AND l.business_id=v_b AND
    (v_email IS NOT NULL AND lower(btrim(l.email))=v_email OR
     v_phone IS NOT NULL AND private.link_phone_identity_key(l.phone)=private.link_phone_identity_key(v_phone))) THEN
    RAISE EXCEPTION 'El lead seleccionado no corresponde a la identidad revisada';
   END IF;
 ELSE
   SELECT id INTO v_control FROM public.controls WHERE slug='link-control-central' LIMIT 1;
   IF v_control IS NULL THEN RAISE EXCEPTION 'Control central no disponible'; END IF;
   INSERT INTO public.sales_leads(control_id,business_id,source,external_ref,full_name,email,phone,interested_product,message,stage,metadata)
   VALUES(v_control,v_b,v_inbox.channel,v_inbox.external_ref,v_name,v_email,v_phone,
     nullif(left(coalesce(array_to_string(v_products,', '),btrim(coalesce(p_data->>'interested_product',''))),600),''),
     v_inbox.raw_message,'new',
     jsonb_build_object('inbox_id',v_inbox.id,'intake','LINK_ID_reviewed','product_ids',to_jsonb(v_product_ids),'review',v_review,'evidence',v_evidence))
   RETURNING id INTO v_lead;
 END IF;
 UPDATE public.link_sales_inbox SET status='converted',lead_id=v_lead,review=jsonb_build_object('name',v_name,'email',v_email,'phone',v_phone,'product_ids',v_product_ids,'reviewed_by',v_uid,'details',v_review),
 evidence=v_evidence,reviewed_by=v_uid,reviewed_at=now(),updated_at=now() WHERE id=v_id;
 SELECT person_id INTO v_person FROM public.link_person_leads WHERE lead_id=v_lead;
 IF v_person IS NOT NULL AND (p_data->>'existing_lead_id') IS NOT NULL THEN
  INSERT INTO public.link_interactions(person_id,business_id,lead_id,action_type,channel,source,confidence,metadata)
  VALUES(v_person,v_b,v_lead,'inbound_message',v_inbox.channel,'link-ventas-inbox','observed',jsonb_build_object('inbox_id',v_inbox.id));
 END IF;
 RETURN jsonb_build_object('ok',true,'inbox_id',v_id,'lead_id',v_lead,'person_matched',v_person IS NOT NULL,'identity_needs_review',v_person IS NULL);
END
$function$;
REVOKE ALL ON FUNCTION public.link_sales_acquisition(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_acquisition(text,jsonb) TO authenticated;


-- link_sales_rrss
CREATE OR REPLACE FUNCTION public.link_sales_rrss(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_b uuid;v_role text;v_msg uuid;v_ch text;v_ref text;v_fp text;
 v_message text;v_conversation uuid;v_participant text;v_candidate record;v_record uuid;v_original timestamptz;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 v_b:=nullif(p_data->>'business_id','')::uuid;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Sin acceso a este negocio'; END IF;
 IF p_action='candidates' THEN
   RETURN jsonb_build_object('ok',true,'candidates',coalesce((
   SELECT jsonb_agg(jsonb_build_object('message_id',t.message_id,'conversation_id',t.conversation_id,'channel',t.platform,
   'participant_name',t.participant_name,'raw_message',t.raw_message,'original_at',t.original_at,
   'identity_known',t.matched_person_id IS NOT NULL,'existing_lead',
    CASE WHEN EXISTS(SELECT 1 FROM public.sales_leads l WHERE l.id=t.matched_sales_lead_id AND l.business_id=v_b) THEN t.matched_sales_lead_id ELSE NULL END)
   ORDER BY t.original_at DESC)
   FROM (
    SELECT c.conversation_id,c.platform,c.participant_name,c.matched_person_id,c.matched_sales_lead_id,m.id message_id,
      m.message raw_message,COALESCE(m.platform_created_at,m.created_at) original_at
    FROM public.link_rrss_identity_candidates_v c
    JOIN LATERAL (SELECT id,message,platform_created_at,created_at FROM public.link_rrss_messages m
      WHERE m.conversation_id=c.conversation_id AND m.direction='incoming' AND length(btrim(coalesce(m.message,'')))>=3
      ORDER BY COALESCE(m.platform_created_at,m.created_at) DESC LIMIT 1) m ON TRUE
    WHERE c.business_id=v_b AND c.commercial_interest=true
      AND NOT EXISTS(SELECT 1 FROM public.link_sales_inbox i WHERE i.business_id=v_b AND i.external_ref='linkrrss:'||m.id::text)
    ORDER BY COALESCE(m.platform_created_at,m.created_at) DESC LIMIT 60
   ) t),'[]'::jsonb));
 END IF;
 IF v_role='viewer' THEN RAISE EXCEPTION 'Permisos insuficientes para importar'; END IF;
 IF p_action<>'import' THEN RAISE EXCEPTION 'Acción inválida'; END IF;
 v_msg:=nullif(p_data->>'message_id','')::uuid;
 SELECT m.message, m.conversation_id,a.platform,c.participant_name,COALESCE(m.platform_created_at,m.created_at)
 INTO v_message,v_conversation,v_ch,v_participant,v_original
 FROM public.link_rrss_messages m
 JOIN public.link_rrss_conversations c ON c.id=m.conversation_id
 JOIN public.link_rrss_accounts a ON a.id=c.account_id
 JOIN public.link_rrss_sources s ON s.id=a.source_id
 JOIN public.link_rrss_profiles p ON p.id=s.profile_id
 WHERE m.id=v_msg AND m.direction='incoming' AND p.business_id=v_b;
 IF v_message IS NULL OR length(btrim(v_message)) NOT BETWEEN 3 AND 12000 THEN RAISE EXCEPTION 'Mensaje original no disponible o sin texto procesable'; END IF;
 SELECT matched_person_id,matched_sales_lead_id,commercial_interest
 INTO v_candidate FROM public.link_rrss_identity_candidates_v WHERE conversation_id=v_conversation AND business_id=v_b LIMIT 1;
 v_ref:='linkrrss:'||v_msg::text;
 v_ch:=CASE WHEN lower(coalesce(v_ch,'')) IN ('instagram','whatsapp','facebook') THEN lower(v_ch) ELSE 'other' END;
 v_fp:=md5(v_b::text||'|'||v_ch||'|'||v_ref);
 SELECT id INTO v_record FROM public.link_sales_inbox WHERE business_id=v_b AND external_ref=v_ref LIMIT 1;
 IF v_record IS NULL THEN
   INSERT INTO public.link_sales_inbox(business_id,channel,external_ref,raw_message,fingerprint,evidence,review,created_by)
   VALUES(v_b,v_ch,v_ref,btrim(v_message),v_fp,
   jsonb_build_object('source','linkrrss','message_id',v_msg,'conversation_id',v_conversation,'original_at',v_original,
    'identity_candidate',v_candidate.matched_person_id IS NOT NULL,'commercial_hint',v_candidate.commercial_interest),
   jsonb_build_object('suggested_name',left(coalesce(v_participant,''),160)),v_uid)
   ON CONFLICT DO NOTHING RETURNING id INTO v_record;
   IF v_record IS NULL THEN SELECT id INTO v_record FROM public.link_sales_inbox WHERE business_id=v_b AND external_ref=v_ref LIMIT 1; END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'inbox_id',v_record,'message_id',v_msg,'source','linkrrss');
END $function$;
REVOKE ALL ON FUNCTION public.link_sales_rrss(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_rrss(text,jsonb) TO authenticated;
