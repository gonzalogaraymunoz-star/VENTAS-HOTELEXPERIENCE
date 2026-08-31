import type { Product } from '../types';

export function clp(value: number | null | undefined) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function resolveProductPrice(product: Product, pax: number): number | null {
  const prices = product.prices || {};
  const perPax = prices[String(pax)];
  if (typeof perPax === 'number') return perPax;
  if (typeof prices.hotel_sale === 'number') return prices.hotel_sale;
  if (typeof prices.sale === 'number') return prices.sale;
  if (typeof prices.base === 'number') return prices.base;
  return null;
}

export function economics(unitPrice: number, pax: number, operatorCost: number, hotelPct: number, sellerPct: number) {
  const total = Math.max(0, unitPrice) * Math.max(1, pax);
  const cost = Math.max(0, operatorCost);
  const margin = total - cost;
  const distributable = Math.max(0, margin);
  const hotel = distributable * Math.max(0, hotelPct) / 100;
  const seller = distributable * Math.max(0, sellerPct) / 100;
  const platform = distributable - hotel - seller;
  return { total, cost, margin, hotel, seller, platform };
}
