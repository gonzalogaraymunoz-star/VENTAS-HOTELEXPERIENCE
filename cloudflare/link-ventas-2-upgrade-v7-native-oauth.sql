-- LINK Ventas · v7 · Native ChatGPT OAuth integration
-- Supabase LINK CONTROL CENTRAL. This migration adds per-user client grants
-- to the existing v6 public APIs, with real OAuth tokens issued by Supabase Auth.
-- IMPORTANT: Supabase Dashboard OAuth Server -> enable DCR and configure
-- Authorization Path /oauth/consent and Site URL manually. These are not
-- database migrations and are NOT enabled by this file.
CREATE TABLE IF NOT EXISTS public.link_sales_mcp_oauth_grants(
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 client_id uuid NOT NULL,
 business_id uuid NOT NULL REFERENCES public.link_world_businesses(id) ON DELETE CASCADE,
 scopes text[] NOT NULL DEFAULT ARRAY['read','linkid:read']::text[],
 status text NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','revoked')),
 granted_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,client_id),
 CHECK (cardinality(scopes)>0),
 CHECK (scopes <@ ARRAY['read','intake','sales','linkid:read']::text[])
);
ALTER TABLE public.link_sales_mcp_oauth_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_sales_mcp_oauth_grants FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.link_sales_mcp_oauth_rate(
 user_id uuid NOT NULL,
 client_id uuid NOT NULL,
 window_start timestamptz NOT NULL,
 calls int NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,client_id,window_start)
);
ALTER TABLE public.link_sales_mcp_oauth_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_sales_mcp_oauth_rate FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.link_sales_mcp_consent(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE v_user uuid:=auth.uid();v_b uuid;v_client uuid;v_role text;v_scopes text[];v_name text;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
 IF jsonb_typeof(coalesce(p_data,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Entrada inválida'; END IF;
 IF p_action='businesses' THEN
  RETURN jsonb_build_object('ok',true,'businesses',
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'global_id',b.global_id,'role',m.role) ORDER BY b.name)
     FROM public.link_sales_members m JOIN public.link_world_businesses b ON b.id=m.business_id
     WHERE m.user_id=v_user),'[]'::jsonb));
 END IF;
 IF p_action='grants' THEN
  RETURN jsonb_build_object('ok',true,'grants',coalesce((
   SELECT jsonb_agg(jsonb_build_object('client_id',g.client_id,'business_id',g.business_id,'business_name',b.name,
    'scopes',g.scopes,'status',g.status,'granted_at',g.granted_at,'updated_at',g.updated_at)
    ORDER BY g.updated_at DESC)
   FROM public.link_sales_mcp_oauth_grants g
   JOIN public.link_world_businesses b ON b.id=g.business_id
   WHERE g.user_id=v_user),'[]'::jsonb));
 END IF;
 v_client:=nullif(p_data->>'client_id','')::uuid;
 IF v_client IS NULL THEN RAISE EXCEPTION 'Cliente OAuth requerido'; END IF;
 -- Do not allow forged or unregistered clients. Only ChatGPT redirect URIs for this initial pilot.
 SELECT client_name INTO v_name FROM auth.oauth_clients
 WHERE id=v_client AND deleted_at IS NULL
   AND (redirect_uris ILIKE '%https://chatgpt.com/connector/oauth/%' OR redirect_uris ILIKE '%https://chatgpt.com/connector_platform_oauth_redirect%');
 IF v_name IS NULL THEN RAISE EXCEPTION 'Cliente ChatGPT OAuth no registrado'; END IF;
 IF p_action='approve' THEN
  v_b:=nullif(p_data->>'business_id','')::uuid;
  SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_user;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Negocio no autorizado'; END IF;
  IF jsonb_typeof(coalesce(p_data->'scopes','null'::jsonb))<>'array' THEN RAISE EXCEPTION 'Permisos inválidos'; END IF;
  v_scopes:=ARRAY(SELECT DISTINCT value FROM jsonb_array_elements_text(p_data->'scopes') ORDER BY 1);
  IF cardinality(v_scopes)<1 OR NOT (v_scopes <@ ARRAY['read','intake','sales','linkid:read']::text[]) THEN
   RAISE EXCEPTION 'Permisos no autorizados'; END IF;
  IF v_role='viewer' AND v_scopes && ARRAY['intake','sales']::text[] THEN
   RAISE EXCEPTION 'Rol solo lectura'; END IF;
  INSERT INTO public.link_sales_mcp_oauth_grants(user_id,client_id,business_id,scopes,status)
   VALUES(v_user,v_client,v_b,v_scopes,'approved')
   ON CONFLICT(user_id,client_id)
   DO UPDATE SET business_id=excluded.business_id,scopes=excluded.scopes,status='approved',
    granted_at=now(),updated_at=now(),revoked_at=NULL;
  RETURN jsonb_build_object('ok',true,'status','approved','business_id',v_b,'client_id',v_client,'scopes',v_scopes);
 ELSIF p_action='revoke' THEN
  UPDATE public.link_sales_mcp_oauth_grants SET status='revoked',revoked_at=now(),updated_at=now()
  WHERE user_id=v_user AND client_id=v_client AND status='approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Autorización no encontrada'; END IF;
  RETURN jsonb_build_object('ok',true,'status','revoked');
 END IF;
 RAISE EXCEPTION 'Acción desconocida';
END $function$;
CREATE OR REPLACE FUNCTION public.link_sales_mcp_execute(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'private'
AS $function$
DECLARE v_user uuid:=auth.uid();v_client uuid;v_grant public.link_sales_mcp_oauth_grants%rowtype;
 v_role text;v_act text;v_scope text;v_body jsonb;v_result jsonb;v_hit int;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
 IF jsonb_typeof(coalesce(p_data,'{}'::jsonb))<>'object' OR length(p_data::text)>18000
  THEN RAISE EXCEPTION 'Entrada inválida'; END IF;
 v_client:=nullif(auth.jwt()->>'client_id','')::uuid;
 IF v_client IS NULL THEN RAISE EXCEPTION 'Se requiere un token OAuth de cliente'; END IF;
 SELECT * INTO v_grant FROM public.link_sales_mcp_oauth_grants g
 WHERE g.user_id=v_user AND g.client_id=v_client AND g.status='approved';
 IF NOT FOUND THEN RAISE EXCEPTION 'ChatGPT aún no fue autorizado para esta identidad'; END IF;
 -- Verify client stays registered as a ChatGPT OAuth application, and business membership remains current.
 IF NOT EXISTS(SELECT 1 FROM auth.oauth_clients oc WHERE oc.id=v_client AND oc.deleted_at IS NULL
  AND (oc.redirect_uris ILIKE '%https://chatgpt.com/connector/oauth/%' OR oc.redirect_uris ILIKE '%https://chatgpt.com/connector_platform_oauth_redirect%')) THEN RAISE EXCEPTION 'Cliente OAuth revocado'; END IF;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_grant.business_id AND user_id=v_user;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Acceso al negocio revocado'; END IF;
 v_act:=lower(btrim(coalesce(p_action,'')));
 v_scope:=CASE
  WHEN v_act IN ('profile','dashboard','requests','products','leads','identity_preview','feed_status') THEN 'read'
  WHEN v_act IN ('linkid_overview','linkid_search_people','linkid_get_person','linkid_resolve_contact') THEN 'linkid:read'
  WHEN v_act IN ('receive_request','convert_request') THEN 'intake'
  WHEN v_act IN ('create_product','update_product','set_stage','quote','accept_sale','mark_ready') THEN 'sales'
  ELSE NULL END;
 IF v_scope IS NULL OR NOT (v_scope=ANY(v_grant.scopes)) THEN RAISE EXCEPTION 'Permiso de ChatGPT insuficiente'; END IF;
 IF v_scope IN ('sales','intake') AND v_role='viewer' THEN RAISE EXCEPTION 'Rol solo lectura'; END IF;
 IF p_data?'business_id' AND p_data->>'business_id' IS DISTINCT FROM v_grant.business_id::text
 THEN RAISE EXCEPTION 'La solicitud intenta acceder a otro negocio'; END IF;
 INSERT INTO public.link_sales_mcp_oauth_rate(user_id,client_id,window_start,calls)
 VALUES(v_user,v_client,date_trunc('minute',now()),1)
 ON CONFLICT(user_id,client_id,window_start) DO UPDATE SET calls=public.link_sales_mcp_oauth_rate.calls+1
 RETURNING calls INTO v_hit;
 IF v_hit>60 THEN RAISE EXCEPTION 'Demasiadas solicitudes OAuth por minuto'; END IF;
 v_body:=p_data||jsonb_build_object('business_id',v_grant.business_id);
 IF v_act='profile' THEN
  v_result:=jsonb_build_object('id',encode(extensions.digest(v_user::text||'|'||v_grant.business_id::text,'sha256'),'hex'),
   'business_id',v_grant.business_id,'business_name',(SELECT name FROM public.link_world_businesses WHERE id=v_grant.business_id),
   'scopes',v_grant.scopes);
 ELSIF v_act IN ('dashboard','products','leads') THEN
  v_result:=public.link_sales_portal('home',v_body);
  IF v_act='products' THEN v_result:=jsonb_build_object('ok',true,'items',coalesce(v_result->'items','[]'::jsonb)); END IF;
  IF v_act='leads' THEN v_result:=jsonb_build_object('ok',true,'leads',coalesce(v_result->'leads','[]'::jsonb)); END IF;
 ELSIF v_act='requests' THEN v_result:=public.link_sales_acquisition('list',v_body);
 ELSIF v_act='identity_preview' THEN v_result:=public.link_sales_acquisition('identity_preview',v_body);
 ELSIF v_act='feed_status' THEN v_result:=public.link_sales_feed_control('status',v_body);
 ELSIF v_scope='linkid:read' THEN v_result:=public.link_sales_linkid(substring(v_act from 8),v_body);
 ELSIF v_act='receive_request' THEN v_result:=public.link_sales_acquisition('receive',v_body);
 ELSIF v_act='convert_request' THEN
  IF p_data->>'review_confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Revisión humana requerida'; END IF;
  v_result:=public.link_sales_acquisition('convert',v_body);
 ELSIF v_act='quote' THEN v_result:=public.link_sales_quote_multi(v_body);
 ELSIF v_act IN ('create_product','update_product','set_stage','accept_sale','mark_ready') THEN
  IF v_act IN ('accept_sale','mark_ready') AND p_data->>'human_confirmed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'Confirmación humana requerida'; END IF;
  v_result:=public.link_sales_portal(CASE WHEN v_act='accept_sale' THEN 'accept_quote' ELSE v_act END,v_body);
 END IF;
 RETURN jsonb_build_object('ok',true,'action',v_act,'business_id',v_grant.business_id,'data',v_result);
END $function$;
REVOKE ALL ON FUNCTION public.link_sales_mcp_consent(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_mcp_consent(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.link_sales_mcp_execute(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_mcp_execute(text,jsonb) TO authenticated;

-- Cleanup optional recurring cron; create once per deployment.
SELECT cron.schedule('link-ventas-oauth-rate-prune','15 4 * * *',
 'DELETE FROM public.link_sales_mcp_oauth_rate WHERE window_start < now() - interval ''2 days'';');
