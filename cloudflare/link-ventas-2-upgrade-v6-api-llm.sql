-- LINK Ventas + LINK ID · individual LLM API v6
-- Apply after cloudflare/link-ventas-2-upgrade-v5.sql.
-- Every token is scoped to one business and its generating user.
-- No plaintext token stored. UI shows it once; revocable and expires in max 90 days.
-- Deny write to viewers. Separate read/intake/sales/linkid:read scopes.
CREATE TABLE IF NOT EXISTS public.link_sales_api_credentials(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.link_world_businesses(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 3 AND 100),
 token_hash text NOT NULL UNIQUE,
 token_prefix text NOT NULL,
 scopes text[] NOT NULL DEFAULT ARRAY['read']::text[],
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 expires_at timestamptz NOT NULL,
 last_used_at timestamptz,
 used_count bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 CHECK (cardinality(scopes)>0)
);
ALTER TABLE public.link_sales_api_credentials DROP CONSTRAINT IF EXISTS link_sales_api_credentials_scopes_check;
ALTER TABLE public.link_sales_api_credentials ADD CONSTRAINT link_sales_api_credentials_scopes_check
 CHECK (scopes <@ ARRAY['read','intake','sales','linkid:read']::text[]);
CREATE INDEX IF NOT EXISTS link_sales_api_credentials_bus_idx ON public.link_sales_api_credentials(business_id,status,expires_at);
CREATE INDEX IF NOT EXISTS link_sales_api_key_owner_idx ON public.link_sales_api_credentials(created_by,business_id,status);
ALTER TABLE public.link_sales_api_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_sales_api_credentials FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS public.link_sales_api_rate_window(
 key_id uuid NOT NULL REFERENCES public.link_sales_api_credentials(id) ON DELETE CASCADE,
 period timestamptz NOT NULL,
 calls integer NOT NULL DEFAULT 0 CHECK(calls>=0),
 PRIMARY KEY(key_id,period)
);
ALTER TABLE public.link_sales_api_rate_window ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_sales_api_rate_window FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS link_sales_api_rate_cleanup ON public.link_sales_api_rate_window(period);

CREATE OR REPLACE FUNCTION public.link_sales_api_execute(p_token text, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
DECLARE v_key public.link_sales_api_credentials%rowtype;v_role text;v_action text;v_scope text;v_data jsonb;
 v_result jsonb;v_hit integer;
BEGIN
 IF p_token !~ '^lvs_[a-f0-9]{64}$' OR length(p_token)<>68 THEN RAISE EXCEPTION 'Clave no válida'; END IF;
 IF jsonb_typeof(coalesce(p_data,'{}'::jsonb))<>'object' OR length(p_data::text)>18000
   THEN RAISE EXCEPTION 'Datos no válidos'; END IF;
 SELECT * INTO v_key FROM public.link_sales_api_credentials
 WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  AND status='active' AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'Clave expirada, revocada o incorrecta'; END IF;
 SELECT role INTO v_role FROM public.link_sales_members
 WHERE business_id=v_key.business_id AND user_id=v_key.created_by;
 INSERT INTO public.link_sales_api_rate_window(key_id,period,calls)
 VALUES(v_key.id,date_trunc('minute',now()),1)
 ON CONFLICT (key_id,period) DO UPDATE SET calls=public.link_sales_api_rate_window.calls+1
 RETURNING calls INTO v_hit;
 IF v_hit>90 THEN RAISE EXCEPTION 'Límite de 90 llamadas por minuto para esta clave'; END IF;
 IF v_role IS NULL THEN RAISE EXCEPTION 'El propietario ya no tiene acceso al negocio'; END IF;
 v_action:=lower(btrim(coalesce(p_action,'')));
 v_scope:=CASE WHEN v_action IN ('dashboard','requests','identity_preview','feed_status','products','leads') THEN 'read'
  WHEN v_action IN ('linkid_overview','linkid_search_people','linkid_get_person','linkid_resolve_contact') THEN 'linkid:read'
  WHEN v_action IN ('receive_request','convert_request') THEN 'intake'
  WHEN v_action IN ('create_product','update_product','set_stage','quote','accept_sale','mark_ready') THEN 'sales'
  ELSE NULL END;
 IF v_scope IS NULL OR NOT(v_scope=ANY(v_key.scopes)) THEN RAISE EXCEPTION 'Permiso insuficiente o acción no soportada'; END IF;
 IF v_scope IN ('sales','intake') AND v_role='viewer' THEN RAISE EXCEPTION 'Rol solo lectura'; END IF;
 IF (p_data ? 'business_id') AND nullif(p_data->>'business_id','') IS DISTINCT FROM v_key.business_id::text
  THEN RAISE EXCEPTION 'La credencial pertenece a otro negocio'; END IF;
 v_data:=p_data||jsonb_build_object('business_id',v_key.business_id);
 -- Existing RPCs have ownership and RLS safeguards based on auth.uid(); set a trusted
 -- local request identity after token verification. SET LOCAL has transaction scope.
 PERFORM set_config('request.jwt.claim.sub',v_key.created_by::text,true);
 IF v_action IN ('dashboard','products','leads') THEN
   v_result:=public.link_sales_portal('home',v_data);
   IF v_action='products' THEN v_result:=jsonb_build_object('ok',true,'business_id',v_key.business_id,'items',coalesce(v_result->'items','[]'::jsonb));
   ELSIF v_action='leads' THEN v_result:=jsonb_build_object('ok',true,'business_id',v_key.business_id,'leads',coalesce(v_result->'leads','[]'::jsonb)); END IF;
 ELSIF v_scope='linkid:read' THEN v_result:=public.link_sales_linkid(substr(v_action,8),v_data);
 ELSIF v_action='requests' THEN v_result:=public.link_sales_acquisition('list',v_data);
 ELSIF v_action='identity_preview' THEN v_result:=public.link_sales_acquisition('identity_preview',v_data);
 ELSIF v_action='feed_status' THEN v_result:=public.link_sales_feed_control('status',v_data);
 ELSIF v_action='receive_request' THEN v_result:=public.link_sales_acquisition('receive',v_data);
 ELSIF v_action='convert_request' THEN
   IF (p_data->>'review_confirmed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Revisión humana obligatoria para adquirir'; END IF;
   v_result:=public.link_sales_acquisition('convert',v_data);
 ELSIF v_action IN ('create_product','update_product','set_stage','accept_sale','mark_ready') THEN
   IF v_action='accept_sale' THEN
     IF (p_data->>'human_confirmed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirmación humana del cierre obligatoria'; END IF;
     v_result:=public.link_sales_portal('accept_quote',v_data);
   ELSIF v_action='mark_ready' THEN
     IF (p_data->>'human_confirmed') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirmación humana de operaciones obligatoria'; END IF;
     v_result:=public.link_sales_portal('mark_ready',v_data);
   ELSE v_result:=public.link_sales_portal(v_action,v_data); END IF;
 ELSIF v_action='quote' THEN v_result:=public.link_sales_quote_multi(v_data);
 END IF;
 UPDATE public.link_sales_api_credentials SET last_used_at=now(),used_count=used_count+1 WHERE id=v_key.id;
 RETURN jsonb_build_object('ok',true,'action',v_action,'business_id',v_key.business_id,'data',v_result);
END $function$;

CREATE OR REPLACE FUNCTION public.link_sales_api_keys(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_b uuid;v_role text;v_name text;v_scopes text[];v_ttl int;
 v_secret text;v_new_id uuid;v_key uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 IF jsonb_typeof(coalesce(p_data,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Formato inválido'; END IF;
 v_b:=nullif(p_data->>'business_id','')::uuid;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Negocio no autorizado'; END IF;
 IF p_action='list' THEN
  RETURN jsonb_build_object('ok',true,'keys',coalesce((
   SELECT jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,'token_prefix',k.token_prefix,
   'scopes',k.scopes,'status',k.status,'expires_at',k.expires_at,'last_used_at',k.last_used_at,'used_count',k.used_count,'created_at',k.created_at)
   ORDER BY k.created_at DESC)
   FROM public.link_sales_api_credentials k WHERE k.business_id=v_b AND k.created_by=v_uid),'[]'::jsonb));
 END IF;
 IF p_action='create' THEN
  v_name:=btrim(coalesce(p_data->>'name',''));
  v_scopes:=ARRAY(SELECT DISTINCT jsonb_array_elements_text(coalesce(p_data->'scopes','["read","intake","linkid:read"]'::jsonb)) ORDER BY 1);
  v_ttl:=coalesce(nullif(p_data->>'days','')::int,60);
  IF length(v_name) NOT BETWEEN 3 AND 100 THEN RAISE EXCEPTION 'Nombre de integración inválido'; END IF;
  IF v_ttl NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Duración máxima: 90 días'; END IF;
  IF cardinality(v_scopes)<1 OR NOT v_scopes <@ ARRAY['read','intake','sales','linkid:read']::text[] THEN RAISE EXCEPTION 'Permisos inválidos'; END IF;
  IF v_role='viewer' AND (v_scopes && ARRAY['intake','sales']::text[]) THEN RAISE EXCEPTION 'Los usuarios de solo lectura no pueden crear claves de escritura'; END IF;
  IF (SELECT count(*) FROM public.link_sales_api_credentials k WHERE k.business_id=v_b AND k.created_by=v_uid AND k.status='active' AND k.expires_at>now())>=6
    THEN RAISE EXCEPTION 'Máximo seis credenciales activas por negocio'; END IF;
  v_secret:='lvs_'||encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.link_sales_api_credentials(business_id,created_by,name,token_hash,token_prefix,scopes,expires_at)
  VALUES(v_b,v_uid,v_name,encode(extensions.digest(v_secret,'sha256'),'hex'),left(v_secret,12),v_scopes,now()+make_interval(days=>v_ttl))
  RETURNING id INTO v_new_id;
  RETURN jsonb_build_object('ok',true,'key_id',v_new_id,'token_once',v_secret,'scopes',v_scopes,
    'expires_at',now()+make_interval(days=>v_ttl),'warning','La clave solo se muestra una vez. Nunca la incluyas en una URL ni en código público.');
 ELSIF p_action='revoke' THEN
  v_key:=nullif(p_data->>'key_id','')::uuid;
  UPDATE public.link_sales_api_credentials SET status='revoked',revoked_at=now()
   WHERE id=v_key AND business_id=v_b AND created_by=v_uid AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Clave activa no encontrada'; END IF;
  RETURN jsonb_build_object('ok',true,'status','revoked','key_id',v_key);
 END IF;
 RAISE EXCEPTION 'Acción no reconocida';
END $function$;

CREATE OR REPLACE FUNCTION public.link_sales_linkid(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE v_uid uuid:=auth.uid();v_b uuid;v_role text;v_search text;v_code text;v_id uuid;v_email text;v_phone text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 IF jsonb_typeof(coalesce(p_data,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'Formato inválido'; END IF;
 v_b:=nullif(p_data->>'business_id','')::uuid;
 SELECT role INTO v_role FROM public.link_sales_members WHERE business_id=v_b AND user_id=v_uid;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Sin acceso a este negocio en LINK ID'; END IF;
 IF p_action='overview' THEN
   RETURN jsonb_build_object('ok',true,'business',(
    SELECT jsonb_build_object('id',b.id,'global_id',b.global_id,'name',b.name,'verification_status',b.verification_status)
    FROM public.link_world_businesses b WHERE b.id=v_b),
    'people_count',(SELECT count(DISTINCT pl.person_id) FROM public.link_person_leads pl WHERE pl.business_id=v_b),
    'products',coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',i.id,'link_id',e.global_id,'name',i.name,'status',i.status) ORDER BY i.name)
      FROM public.link_sales_items i
      LEFT JOIN public.ecosystem_entities e ON e.owner_record_id=i.id::text AND e.owner_table='link_sales_items'
      WHERE i.business_id=v_b),'[]'::jsonb));
 ELSIF p_action='search_people' THEN
  v_search:=left(btrim(coalesce(p_data->>'query','')),100);
  IF length(v_search)<3 THEN RAISE EXCEPTION 'Introduce al menos 3 caracteres'; END IF;
  RETURN jsonb_build_object('ok',true,'people',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',t.id,'link_id',t.universal_code,'name',t.display_name,'leads',t.lead_count))
    FROM (
      SELECT p.id,p.universal_code,p.display_name,count(DISTINCT pl.lead_id) lead_count
      FROM public.link_persons p JOIN public.link_person_leads pl ON pl.person_id=p.id
      JOIN public.sales_leads l ON l.id=pl.lead_id AND l.business_id=v_b
      WHERE pl.business_id=v_b AND p.status NOT IN ('merged','inactive')
        AND (p.display_name ILIKE '%'||replace(replace(v_search,'%','\%'),'_','\_')||'%' ESCAPE '\'
             OR p.universal_code=upper(v_search))
      GROUP BY p.id,p.universal_code,p.display_name ORDER BY p.display_name LIMIT 20
    ) t),'[]'::jsonb));
 ELSIF p_action='get_person' THEN
  v_code:=upper(nullif(btrim(p_data->>'link_id'),''));
  v_id:=nullif(p_data->>'person_id','')::uuid;
  IF v_code IS NULL AND v_id IS NULL THEN RAISE EXCEPTION 'Indica person_id o LINK ID'; END IF;
  RETURN jsonb_build_object('ok',true,'person',(
    SELECT jsonb_build_object('id',p.id,'link_id',p.universal_code,'name',p.display_name,'leads',
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'stage',l.stage,'product',l.interested_product,'lead_link_id',li.universal_code))
        FROM public.link_person_leads pl2 JOIN public.sales_leads l ON l.id=pl2.lead_id AND l.business_id=v_b
        LEFT JOIN public.link_lead_identities li ON li.lead_id=l.id AND li.business_id=v_b
        WHERE pl2.person_id=p.id AND pl2.business_id=v_b),'[]'::jsonb))
    FROM public.link_persons p WHERE (p.id=v_id OR p.universal_code=v_code)
      AND p.status NOT IN ('merged','inactive')
      AND EXISTS (SELECT 1 FROM public.link_person_leads pl JOIN public.sales_leads l ON l.id=pl.lead_id AND l.business_id=v_b
                  WHERE pl.business_id=v_b AND pl.person_id=p.id)));
 ELSIF p_action='resolve_contact' THEN
   v_email:=nullif(lower(btrim(p_data->>'email')),'');
   v_phone:=private.link_phone_identity_key(p_data->>'phone');
   IF v_phone IS NOT NULL AND length(v_phone)<8 THEN v_phone:=NULL; END IF;
   IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'Se requiere email o teléfono válido'; END IF;
   RETURN jsonb_build_object('ok',true,'candidates',coalesce((
     SELECT jsonb_agg(jsonb_build_object('id',t.id,'link_id',t.universal_code,'name',t.display_name))
     FROM (
       SELECT DISTINCT p.id,p.universal_code,p.display_name
       FROM public.link_persons p JOIN public.link_person_leads pl ON pl.person_id=p.id
       JOIN public.sales_leads l ON l.id=pl.lead_id AND l.business_id=v_b
       WHERE pl.business_id=v_b AND p.status NOT IN ('merged','inactive')
         AND ((v_email IS NOT NULL AND lower(btrim(p.email))=v_email) OR
              (v_phone IS NOT NULL AND private.link_phone_identity_key(p.phone)=v_phone))
       ORDER BY p.display_name LIMIT 10
     ) t),'[]'::jsonb));
 ELSE RAISE EXCEPTION 'Acción LINK ID no autorizada'; END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.link_sales_api_keys(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_api_keys(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.link_sales_api_execute(text,text,jsonb) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.link_sales_api_execute(text,text,jsonb) TO anon;
REVOKE ALL ON FUNCTION public.link_sales_linkid(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_sales_linkid(text,jsonb) TO authenticated;
