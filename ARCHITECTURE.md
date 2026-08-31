# Arquitectura — LINK Ventas ↔ HOTEL EXPERIENCE

## Separación de responsabilidades

### LINK Ventas
- Captación.
- Lead.
- Cliente principal y acompañantes.
- Selección de uno o varios productos.
- Precio de venta.
- Costo operador conocido o pendiente.
- Margen comercial.
- Comisión hotel.
- Comisión vendedor.
- Pago del cliente.
- Estado comercial.

### HOTEL EXPERIENCE Operaciones
- Validación/selección final de operador.
- Guía, conductor, vehículo, recursos e insumos.
- Pick-up y punto de encuentro.
- Hoja de riesgo.
- Ejecución.
- Cierre operacional.
- Pago operador.
- Cierre de comisiones y feedback.

## Handoff

Una venta confirmada crea `lead_services` con:

- `booking_status = confirmed`
- `estado_operacion = Pendiente`
- economía completa disponible
- operador propuesto opcional en `service_assignments`

Operaciones debe trabajar sobre esos mismos registros; nunca importar/copiar la venta a otra base.

## Identidad

- Lead / Reserva: `PREFIX-YYMM-###`
- Pasajero: `LEAD-P01`
- Servicio: `LEAD-S01`
- Pago: `SERVICIO-PG01`
- Comisión: `SERVICIO-CM01`
- Producto: conserva `product_catalog.code`
- UUID: se mantiene como PK técnica interna.

## Economía

Para cada servicio:

`venta_total = precio_unitario × pax`

`margen_comercial = venta_total - costo_operador_total`

`comision_hotel = margen_comercial × % hotel`

`comision_vendedor = margen_comercial × % vendedor`

`margen_hotel_experience = margen_comercial - comision_hotel - comision_vendedor`

Si el costo operador no está confirmado, se deja en 0 visualmente y debe validarse antes del cierre financiero. La interfaz no inventa costos.
