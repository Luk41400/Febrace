CREATE TABLE IF NOT EXISTS market_catalog (
  id UUID PRIMARY KEY,
  title VARCHAR(200) NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  category VARCHAR(100) NOT NULL DEFAULT '',
  price NUMERIC(14, 2) NOT NULL CHECK (price > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  seller VARCHAR(160) NOT NULL CHECK (length(trim(seller)) > 0),
  source VARCHAR(160) NOT NULL CHECK (length(trim(source)) > 0),
  image_url TEXT NOT NULL DEFAULT '' CHECK (image_url = '' OR image_url ~ '^https://'),
  product_url TEXT NOT NULL CHECK (product_url ~ '^https://'),
  rating NUMERIC(2, 1) CHECK (rating >= 0 AND rating <= 5),
  reviews INTEGER CHECK (reviews >= 0),
  search_text TEXT GENERATED ALWAYS AS (
    translate(
      lower(title || ' ' || description || ' ' || category),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    )
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_catalog_search_idx
  ON market_catalog USING GIN (to_tsvector('simple', search_text));

DROP TRIGGER IF EXISTS market_catalog_set_updated_at ON market_catalog;
CREATE TRIGGER market_catalog_set_updated_at
  BEFORE UPDATE ON market_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
