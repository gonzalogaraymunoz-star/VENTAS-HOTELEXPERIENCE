import './EmbeddedCatalog.css';

const DEFAULT_CATALOG_URL = 'https://lamatravelers.com/catalogo';

export default function EmbeddedCatalog() {
  const catalogUrl = (import.meta.env.VITE_CATALOG_URL as string | undefined) || DEFAULT_CATALOG_URL;

  return <div className="embedded-catalog-shell">
    <iframe
      className="embedded-catalog-frame"
      src={catalogUrl}
      title="Catálogo de experiencias"
      loading="eager"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  </div>;
}
