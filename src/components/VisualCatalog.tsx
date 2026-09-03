import { useMemo, useState } from 'react';
import { ArrowRight, Check, ImageOff, Search, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { clp, resolveProductPrice } from '../lib/money';
import type { Product } from '../types';
import './VisualCatalog.css';

type CatalogFamily = {
  slug: string;
  name: string;
  category: string;
  description: string;
  products: Product[];
};

type VariantMeta = {
  title: string;
  eyebrow: string;
  description: string;
};

const VISIBLE_CATEGORIES = new Set([
  'Nocturno',
  'Tour día completo',
  'Tour medio día',
  'Transporte',
  'SPA / Terapias',
]);

function normalizeSlug(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function rawSlug(product: Product) {
  return product.product_slug || normalizeSlug(product.name);
}

/**
 * Navegación comercial curada. Vamos incorporando cada producto a medida que
 * validamos su familia. Supabase sigue guardando las tarifas/modalidades reales.
 */
function familySlug(product: Product) {
  const slug = rawSlug(product);
  if (slug === 'astronomico' || slug.startsWith('astronomico_')) return 'astronomico';
  return slug;
}

function familyName(slug: string, product: Product) {
  if (slug === 'astronomico') return 'Astronómico';
  return product.name;
}

function imagePaths(product: Product) {
  const slug = rawSlug(product);
  const category = String(product.category || '').toLowerCase();
  if (category.includes('transporte')) return [`transporte/${slug}/cover.jpg`];
  if (category.includes('spa') || category.includes('terapia')) return [`bienestar/${slug}/cover.jpg`];
  return [`web-tours/products/${slug}/cover.png`];
}

function publicImageUrl(path: string) {
  return supabase.storage.from('catalog-images').getPublicUrl(path).data.publicUrl;
}

function CatalogImage({ product, alt, className }: { product: Product; alt: string; className?: string }) {
  const candidates = useMemo(() => imagePaths(product).map(publicImageUrl), [product.id, product.product_slug, product.code, product.category]);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!candidates.length || failed) return <div className={`${className || ''} catalog-image-fallback`}><ImageOff size={22}/><span>Imagen no disponible</span></div>;
  return <img
    className={className}
    src={candidates[index]}
    alt={alt}
    loading="lazy"
    onError={() => {
      if (index < candidates.length - 1) setIndex(current => current + 1);
      else setFailed(true);
    }}
  />;
}

function variantMeta(product: Product): VariantMeta {
  const slug = rawSlug(product);
  if (slug === 'astronomico_a_desierto_abierto') return {
    title: 'Desierto abierto', eyebrow: 'Privado · naturaleza',
    description: product.description || 'Observación privada a cielo abierto, lejos del centro.',
  };
  if (slug === 'astronomico_en_hotel') return {
    title: 'En tu hotel', eyebrow: 'Privado · hotel',
    description: product.description || 'La experiencia astronómica llega al hotel del pasajero.',
  };
  if (slug === 'astronomico_privado') return {
    title: 'Privado', eyebrow: 'Experiencia dedicada',
    description: product.description || 'Una experiencia astronómica dedicada exclusivamente al grupo.',
  };
  if (slug === 'astronomico' && product.price_mode === 'regular_per_pax') return {
    title: 'Compartido', eyebrow: 'Grupo compartido',
    description: product.description || 'Astronómico en grupo con tarifa por pasajero.',
  };
  if (slug === 'astronomico' && product.price_mode === 'regular_commission') return {
    title: 'Regular', eyebrow: 'Alternativa regular',
    description: product.description || 'Alternativa regular del tour astronómico.',
  };
  const label = product.price_mode.replace(/_/g, ' ');
  return { title: product.name, eyebrow: label, description: product.description || product.schedule || 'Modalidad disponible.' };
}

function variantRank(product: Product) {
  const meta = variantMeta(product).title;
  return ({ Compartido: 1, Regular: 2, Privado: 3, 'Desierto abierto': 4, 'En tu hotel': 5 } as Record<string, number>)[meta] || 20;
}

function familyMediaProduct(family: CatalogFamily) {
  if (family.slug === 'astronomico') {
    return family.products.find(product => rawSlug(product) === 'astronomico' && product.price_mode === 'regular_per_pax')
      || family.products.find(product => rawSlug(product) === 'astronomico')
      || family.products[0];
  }
  return family.products[0];
}

function availablePax(product: Product) {
  const numeric = Object.entries(product.prices || {})
    .filter(([key, value]) => /^\d+$/.test(key) && typeof value === 'number' && value > 0)
    .map(([key]) => Number(key))
    .sort((a, b) => a - b);
  if (numeric.length) return numeric;
  // Tarifas regulares sin tramos explícitos siguen siendo por pasajero.
  if (product.price_mode.includes('regular')) return [1, 2, 3, 4, 5, 6];
  return [1];
}

function quoteFor(product: Product, pax: number) {
  const unit = resolveProductPrice(product, pax);
  if (unit == null || unit <= 0) return { valid: false, unit: 0, total: 0, label: 'Cotización manual' };
  const fixed = product.price_mode === 'hotel_fixed' || product.price_mode === 'lowcost_transport';
  return {
    valid: true,
    unit,
    total: fixed ? unit : unit * Math.max(1, pax),
    label: fixed ? 'por servicio' : 'por persona',
  };
}

export default function VisualCatalog({ products, onQuote }: { products: Product[]; onQuote: (productId: string) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todos');
  const [selectedSlug, setSelectedSlug] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedPax, setSelectedPax] = useState<number | null>(null);

  const families = useMemo<CatalogFamily[]>(() => {
    const map = new Map<string, CatalogFamily>();
    products.forEach(product => {
      if (!VISIBLE_CATEGORIES.has(product.category)) return;
      const slug = familySlug(product);
      const current = map.get(slug) || {
        slug,
        name: familyName(slug, product),
        category: product.category,
        description: product.description || '',
        products: [],
      };
      current.products.push(product);
      if (!current.description && product.description) current.description = product.description;
      map.set(slug, current);
    });
    return Array.from(map.values())
      .map(family => ({ ...family, products: [...family.products].sort((a, b) => variantRank(a) - variantRank(b) || a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [products]);

  const visibleProductsCount = useMemo(() => families.reduce((total, family) => total + family.products.length, 0), [families]);
  const categories = useMemo(() => ['Todos', ...Array.from(new Set(families.map(item => item.category)))], [families]);
  const filtered = useMemo(() => families.filter(item => {
    const text = `${item.name} ${item.category} ${item.description} ${item.products.map(p => `${p.code} ${variantMeta(p).title}`).join(' ')}`.toLowerCase();
    return (category === 'Todos' || item.category === category) && text.includes(query.toLowerCase().trim());
  }), [families, query, category]);

  const selected = families.find(item => item.slug === selectedSlug) || null;
  const selectedProduct = selected?.products.find(product => product.id === selectedProductId) || null;
  const selectedQuote = selectedProduct && selectedPax != null ? quoteFor(selectedProduct, selectedPax) : null;
  const paxOptions = selectedProduct ? availablePax(selectedProduct) : [];

  function openFamily(slug: string) {
    setSelectedSlug(slug);
    setSelectedProductId('');
    setSelectedPax(null);
  }

  function chooseVariant(productId: string) {
    setSelectedProductId(productId);
    setSelectedPax(null);
  }

  function closeFamily() {
    setSelectedSlug('');
    setSelectedProductId('');
    setSelectedPax(null);
  }

  return <div className="visual-catalog">
    <section className="visual-catalog-hero">
      <div><p className="eyebrow">CATÁLOGO VISUAL</p><h1>Primero la experiencia. Después la modalidad.</h1><p>Una vitrina corta para orientar la conversación: elegimos experiencia, alternativa y tramo. El precio aparece recién cuando la elección está definida.</p></div>
      <div className="visual-catalog-count"><span>Experiencias</span><strong>{families.length}</strong><small>{visibleProductsCount} tarifas / modalidades reales en Supabase</small></div>
    </section>

    <section className="visual-catalog-toolbar">
      <div className="visual-catalog-search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar experiencia o necesidad…"/></div>
      <select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(item => <option key={item}>{item}</option>)}</select>
    </section>

    <section className="visual-catalog-grid">
      {filtered.map(family => {
        const mediaProduct = familyMediaProduct(family);
        return <article className="visual-product-card" key={family.slug}>
          <button className="visual-product-image-button" onClick={() => openFamily(family.slug)} aria-label={`Abrir ${family.name}`}>
            <CatalogImage product={mediaProduct} alt={family.name} className="visual-product-image"/>
            <span className="visual-product-category">{family.category}</span>
          </button>
          <div className="visual-product-copy">
            <span className="visual-product-kicker">{family.products.length} alternativa(s)</span>
            <h2>{family.name}</h2>
            <p>{family.description || 'Experiencia disponible en el catálogo HOTEL EXPERIENCE.'}</p>
            <div className="visual-product-bottom compact">
              <div><span>Navegación</span><strong>Explorar opciones</strong></div>
              <button className="button dark" onClick={() => openFamily(family.slug)}>Abrir <ArrowRight size={15}/></button>
            </div>
          </div>
        </article>;
      })}
      {!filtered.length && <div className="visual-catalog-empty"><Search size={22}/><strong>No encontramos experiencias.</strong><span>Prueba otra categoría o búsqueda.</span></div>}
    </section>

    {selected && <div className="catalog-detail-backdrop" onClick={closeFamily}>
      <article className="catalog-detail-sheet" onClick={event => event.stopPropagation()}>
        <button className="catalog-detail-close" onClick={closeFamily}>×</button>
        <div className="catalog-detail-media"><CatalogImage product={familyMediaProduct(selected)} alt={selected.name} className="catalog-detail-image"/></div>
        <div className="catalog-detail-body">
          <div><p className="eyebrow">{selected.category}</p><h2>{selected.name}</h2><p className="catalog-detail-description">{selected.slug === 'astronomico' ? 'Una sola experiencia astronómica, distintas formas de vivirla. Las alternativas comparten la misma identidad visual; cambia la modalidad y su tarifa real.' : selected.description || 'Experiencia disponible para cotización.'}</p></div>

          <section className="catalog-decision-block">
            <header><span>01</span><div><strong>¿Cómo quieres vivirlo?</strong><small>Elige una alternativa. Todavía no mostramos precio.</small></div></header>
            <div className="catalog-idea-map">
              {selected.products.map((product, index) => {
                const meta = variantMeta(product);
                const active = selectedProductId === product.id;
                return <button key={product.id} className={active ? 'active' : ''} onClick={() => chooseVariant(product.id)}>
                  <span className="idea-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="idea-copy"><small>{meta.eyebrow}</small><strong>{meta.title}</strong><em>{meta.description}</em></span>
                  <span className="idea-check">{active ? <Check size={15}/> : <ArrowRight size={15}/>}</span>
                </button>;
              })}
            </div>
          </section>

          <section className={`catalog-decision-block ${selectedProduct ? '' : 'muted-step'}`}>
            <header><span>02</span><div><strong>Selecciona el tramo</strong><small>{selectedProduct ? `${variantMeta(selectedProduct).title} · elige cantidad de pasajeros para resolver la tarifa.` : 'Primero elige una alternativa.'}</small></div></header>
            {selectedProduct && <div className="catalog-pax-options">
              {paxOptions.map(amount => <button key={amount} className={selectedPax === amount ? 'active' : ''} onClick={() => setSelectedPax(amount)}><Users size={14}/><strong>{amount}</strong><span>pax</span></button>)}
            </div>}
          </section>

          <section className={`catalog-price-reveal ${selectedQuote ? 'ready' : ''}`}>
            {!selectedProduct ? <><span>03</span><div><strong>Precio</strong><small>Se revela después de elegir modalidad y tramo.</small></div></> : selectedPax == null ? <><span>03</span><div><strong>Precio aún oculto</strong><small>Selecciona el tramo para ver la tarifa real.</small></div></> : selectedQuote?.valid ? <>
              <div className="catalog-price-context"><span>03 · TARIFA SELECCIONADA</span><strong>{variantMeta(selectedProduct).title} · {selectedPax} pax</strong><small>{clp(selectedQuote.unit)} {selectedQuote.label}</small></div>
              <div className="catalog-price-total"><span>Total</span><strong>{clp(selectedQuote.total)}</strong></div>
              <button className="button dark" onClick={() => onQuote(selectedProduct.id)}>Usar en cotización <ArrowRight size={15}/></button>
            </> : <>
              <div className="catalog-price-context"><span>03 · TARIFA</span><strong>Cotización manual</strong><small>Ese tramo no tiene una tarifa automática registrada. No inventamos precio.</small></div>
              <button className="button dark" onClick={() => onQuote(selectedProduct.id)}>Abrir cotización <ArrowRight size={15}/></button>
            </>}
          </section>
        </div>
      </article>
    </div>}
  </div>;
}
