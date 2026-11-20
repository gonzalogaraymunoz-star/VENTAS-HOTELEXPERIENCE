import tv12 from '../../src/data/tv1_2_crm_cotizador_tours.json';

// One source of truth: the same TV1.2 dataset imported by src/lib/portalTvPricing.ts.
const tours = tv12?.web_view?.tours || [];

function safePax(value) {
  const pax = Math.floor(Number(value) || 1);
  if (pax < 1 || pax > 99) throw new Error('La cantidad de pasajeros debe estar entre 1 y 99.');
  return pax;
}

export function resolveTv12Service(input) {
  const tourId = String(input?.tour_id || '').trim();
  const familyId = String(input?.family_id || '').trim();
  const modality = String(input?.modality || '').trim().toLowerCase();
  const pax = safePax(input?.pax);
  const tour = tours.find(item => item.tour_id === tourId);
  const variant = tour?.modalities?.[modality];

  if (!tour || !['low', 'semiprivado', 'privado'].includes(modality) || !variant) {
    throw new Error('La experiencia o modalidad TV1.2 seleccionada no existe.');
  }
  if (!variant.tariff_found && !variant.declared_available) {
    throw new Error('Esta modalidad no está declarada ni tiene tarifa en TV1.2.');
  }

  let price = null;
  let total = null;
  let pricingStatus = 'manual_quote';
  const pricing = variant.pricing || {};

  if (variant.tariff_found && modality === 'low') {
    const amount = Number(pricing.price_pp_clp || 0);
    if (amount > 0) {
      price = amount;
      total = amount * pax;
      pricingStatus = 'quoted';
    }
  } else if (variant.tariff_found && modality === 'semiprivado') {
    const amount = Number(pricing.price_pp_clp || 0);
    if (pax >= 2 && pax <= 10 && amount > 0) {
      price = amount;
      total = amount * pax;
      pricingStatus = 'quoted';
    }
  } else if (variant.tariff_found && modality === 'privado') {
    const tier = (pricing.tiers || []).find(item => Number(item.pax) === pax);
    if (tier && tier.price_pp_clp != null && tier.group_total_clp != null) {
      price = Number(tier.price_pp_clp);
      total = Number(tier.group_total_clp);
      pricingStatus = 'quoted';
    }
  }

  return {
    kind: 'tour',
    product_name: familyId === 'FAMILY-ASTRONOMICO' && tourId === 'TOUR-ASTRONOMICO_PRIVADO' ? 'Astronómico' : tour.name,
    family_id: familyId || tourId,
    category: tour.category || 'Tour',
    tour_id: tour.tour_id,
    modality,
    pax,
    pricing_status: pricingStatus,
    price_pp_clp: price,
    unit_price_clp: price,
    total_price_clp: total,
    price_unit: 'por persona',
    pricing_source: 'TV1.2 Fauna Experiencias',
    availability_declared: Boolean(variant.declared_available),
    tariff_found: Boolean(variant.tariff_found),
    source: variant.source || null
  };
}

export function resolveCatalogService(product, input) {
  const pax = safePax(input?.pax);
  const prices = product?.prices || {};
  const mode = String(product?.price_mode || '');
  let unit = null;
  let priceUnit = (mode === 'private_per_pax' || mode === 'regular_per_pax' || mode === 'regular_commission')
    ? 'por persona'
    : mode === 'lowcost_transport' && product.category === 'Transporte' ? 'por traslado' : 'por servicio';

  if (mode === 'private_per_pax' || mode === 'regular_per_pax') {
    const value = Number(prices[String(pax)] || 0);
    if (value > 0) {
      unit = value;
    }
  } else if (mode === 'regular_commission') {
    const value = Number(prices.sale || 0);
    if (value > 0) {
      unit = value;
    }
  } else if (mode === 'hotel_fixed' || mode === 'lowcost_transport') {
    const value = Number(prices.hotel_sale || 0);
    if (value > 0) {
      unit = value;
    }
  }

  const total = unit == null ? null : priceUnit === 'por persona' ? unit * pax : unit;
  return {
    kind: 'extra',
    product_name: String(product.name || ''),
    product_id: product.id,
    product_code: product.code,
    category: product.category || 'Otros',
    pax,
    pricing_status: unit == null ? 'manual_quote' : 'quoted',
    price_pp_clp: priceUnit === 'por persona' ? unit : null,
    unit_price_clp: unit,
    total_price_clp: total,
    price_unit: priceUnit,
    pricing_source: 'product_catalog'
  };
}
