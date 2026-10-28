# LINK Ventas + LINK ID · API personal para LLMs · v2.2

**Estado:** API REST + servidor MCP desplegados en Cloudflare. Identidad multiusuario y permisos por negocio verificados en Supabase. **Conexión nativa @ en ChatGPT aún no habilitada**: ChatGPT exige OAuth 2.1 para un servidor MCP autenticado; no es suficiente una clave API personalizada. [Documentación oficial](https://developers.openai.com/plugins/build/auth).

## Endpoints
- Interfaz de administración: https://link-ventas-2.gonzalogaraymunoz.workers.dev/ → **API / LLM**
- REST: `POST https://link-ventas-2.gonzalogaraymunoz.workers.dev/api/v1`
- MCP (Streamable HTTP): `POST https://link-ventas-2.gonzalogaraymunoz.workers.dev/mcp`
- Especificación OpenAPI: `GET https://link-ventas-2.gonzalogaraymunoz.workers.dev/openapi.json`
- Estado del Worker: `GET https://link-ventas-2.gonzalogaraymunoz.workers.dev/health`

## Cómo se genera y administra una clave
1. Ingresar a LINK Ventas con Supabase Auth, seleccionar negocio, abrir **API / LLM** (en teléfono está en **Más**).
2. Pulsar **Crear clave API**. Nombrarla según el cliente (Claude, Cursor, etc.).
3. Seleccionar permisos mínimos, vencimiento (7, 30, 60, 90 días).
4. Copiar el secreto `lvs_...` del modal: **se muestra una vez**. Guardar en el administrador seguro de credenciales del LLM, servidor o entorno.
5. Para cortar acceso, **Revocar clave** en la misma pantalla. Revocación inmediata. Si se extravía, revocar y crear otra.

### Independencia y límites
- **Cada clave es del usuario que la genera + un negocio** (una persona con varios negocios utiliza claves separadas).
- El sistema nunca expone hashes o secretos existentes al frontend, salvo el secreto nuevo en el momento de su creación.
- Lecturas y escrituras siempre usan `business_id` de la credencial, nunca uno impuesto por el LLM.
- 6 claves activas por usuario y negocio; duración máxima 90 días; límite de 90 llamadas/minuto/clave, con conteo transaccional.
- Usuario con rol **viewer** solo puede crear claves `read` y `linkid:read`. Rol **editor** puede usar escritura según permiso; rol **owner** también.
- Auditabilidad: `last_used_at`, `used_count`. No registrar el token en logs.
- No incrustar claves en prompts, código público, capturas, enlaces, chat, repositorios, variables `NEXT_PUBLIC` ni páginas HTML.
- Claves protegidas por SHA-256 de un token aleatorio de 256 bits. Recomendación para despliegue general: segundo control de tasas en Cloudflare, pruebas E2E multiusuario y revisión de `SECURITY DEFINER`/OAuth.

## Permisos
| Scope | Acciones habilitadas |
|---|---|
| `read` | `dashboard`, `products`, `leads`, `requests`, `identity_preview`, `feed_status` |
| `linkid:read` | `linkid_overview`, `linkid_search_people`, `linkid_get_person`, `linkid_resolve_contact` |
| `intake` | `receive_request`, `convert_request` (revisión humana confirmada) |
| `sales` | `create_product`, `update_product`, `set_stage`, `quote`, `accept_sale`, `mark_ready` |

No existe alta directa de personas en LINK ID desde LLM; **la identidad se crea/vincula solo al confirmar una adquisición**. LINK ID API es lectura y resolución conservadora, sin acceso a identidades fuera del negocio. Cotizaciones almacenan los precios históricos; aceptación no implica pago.

## REST · Ejemplo desde backend/terminal
Se debe guardar la clave `lvs_...` en una variable secreta, no pegar en el ejemplo.

```bash
# La variable debe provenir del gestor de secretos; no introducir el token real en el código.
curl -sS -X POST 'https://link-ventas-2.gonzalogaraymunoz.workers.dev/api/v1' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${LINK_VENTAS_API_KEY}" \
  --data '{"action":"linkid_overview","data":{}}'
```

Acciones de ejemplo:

```json
{"action":"products","data":{}}
```

```json
{"action":"linkid_search_people","data":{"query":"Ana"}}
```

```json
{"action":"receive_request","data":{"channel":"whatsapp","external_ref":"mensaje-origen-123","raw_message":"Hola, quisiera cotizar dos excursiones para enero"}}
```

La aduana conserva la solicitud **pendiente**. Solo la revisión humana puede convertirla en lead. El `external_ref` ayuda a evitar duplicados del mismo canal.

## MCP · Para LLMs compatibles con claves HTTP Bearer
Configurar el servidor remoto `https://link-ventas-2.gonzalogaraymunoz.workers.dev/mcp` usando transporte **Streamable HTTP** y autenticación **Bearer** administrada *por el cliente*, nunca dentro de un archivo `mcp.json` distribuido.

MCP expone 16 herramientas nominales para leer negocios, personas LINK ID, solicitudes, productos y ventas; y, si la credencial lo permite, ingresar solicitudes, generar productos y cotizaciones. Las operaciones de aceptar una venta o declarar lista para operar requieren bandera `human_confirmed`.

Ejemplo de handshake de protocolo:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"my-llm","version":"1.0"}}}
```

El servidor valida la credencial también en `initialize` y en `tools/list`. Sin token válido no expone datos. No se han probado clientes MCP externos con credenciales reales.

### Invocación directa en ChatGPT: siguiente paso de autenticación
ChatGPT necesita un flujo de autorización OAuth 2.1 para servidores MCP personales y no presenta tokens de API arbitrarios como credenciales de plugin. La API personal funciona para los clientes que soporten Bearer, pero **no se puede afirmar aún que @LINK Ventas funcione aquí**. La integración nativa requerirá autorizar LINK Ventas con la cuenta del usuario mediante OAuth, conceder permisos por negocio, conectar/instalar el plugin y ejecutar prueba real. No incrustar una clave personal en un paquete de plugin ni compartirla en esta conversación.

## Archivos
- `cloudflare/link-ventas-2.mjs`: UI, REST y MCP.
- `cloudflare/link-ventas-2-upgrade-v6-api-llm.sql`: credenciales personales, ámbitos y funciones.
- Proyecto Supabase: **LINK CONTROL CENTRAL** (no sustituye el catálogo original de Hotel Experience).

## Pruebas realizadas
- SQL en transacción `ROLLBACK`: generación de token por usuario y negocio, lectura LINK ID + ventas, rechazo de otro negocio y acciones sin scope, generación de key de lectura por usuario `viewer`, imposibilidad de otorgar escritura desde `viewer`.
- Compilación sintáctica del frontend y el Worker, despliegue Cloudflare.
- Queda pendiente prueba HTTP E2E con cliente real y verificación de la conexión MCP en el LLM elegido. No se han creado credenciales reales del usuario de forma automática.
