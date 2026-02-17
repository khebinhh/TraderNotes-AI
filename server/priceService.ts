const FUTURES_TO_ETF: Record<string, { yahooFutures: string; yahooEtf: string; tvSymbol: string; fallbackRatio: number }> = {
  "ES1!": { yahooFutures: "ES=F", yahooEtf: "SPY", tvSymbol: "AMEX:SPY", fallbackRatio: 10 },
  "NQ1!": { yahooFutures: "NQ=F", yahooEtf: "QQQ", tvSymbol: "NASDAQ:QQQ", fallbackRatio: 80 },
};

interface PriceCache {
  futuresPrice: number;
  etfPrice: number;
  ratio: number;
  lastUpdated: number;
}

const cache: Record<string, PriceCache> = {};
const CACHE_TTL = 5 * 60 * 1000;

async function fetchYahooPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

export function getFuturesMapping(symbol: string) {
  return FUTURES_TO_ETF[symbol] || null;
}

export function isFuturesSymbol(symbol: string): boolean {
  return symbol in FUTURES_TO_ETF;
}

export async function getLiveRatio(futuresSymbol: string): Promise<{
  ratio: number;
  futuresPrice: number | null;
  etfPrice: number | null;
  etfSymbol: string;
  tvSymbol: string;
  lastUpdated: string;
  isFallback: boolean;
}> {
  const mapping = FUTURES_TO_ETF[futuresSymbol];
  if (!mapping) {
    return {
      ratio: 1,
      futuresPrice: null,
      etfPrice: null,
      etfSymbol: futuresSymbol,
      tvSymbol: futuresSymbol,
      lastUpdated: new Date().toISOString(),
      isFallback: true,
    };
  }

  const cached = cache[futuresSymbol];
  if (cached && Date.now() - cached.lastUpdated < CACHE_TTL) {
    return {
      ratio: cached.ratio,
      futuresPrice: cached.futuresPrice,
      etfPrice: cached.etfPrice,
      etfSymbol: mapping.yahooEtf,
      tvSymbol: mapping.tvSymbol,
      lastUpdated: new Date(cached.lastUpdated).toISOString(),
      isFallback: false,
    };
  }

  const [futuresPrice, etfPrice] = await Promise.all([
    fetchYahooPrice(mapping.yahooFutures),
    fetchYahooPrice(mapping.yahooEtf),
  ]);

  if (futuresPrice && etfPrice && etfPrice > 0) {
    const ratio = futuresPrice / etfPrice;
    cache[futuresSymbol] = {
      futuresPrice,
      etfPrice,
      ratio,
      lastUpdated: Date.now(),
    };
    return {
      ratio,
      futuresPrice,
      etfPrice,
      etfSymbol: mapping.yahooEtf,
      tvSymbol: mapping.tvSymbol,
      lastUpdated: new Date().toISOString(),
      isFallback: false,
    };
  }

  if (cached) {
    return {
      ratio: cached.ratio,
      futuresPrice: cached.futuresPrice,
      etfPrice: cached.etfPrice,
      etfSymbol: mapping.yahooEtf,
      tvSymbol: mapping.tvSymbol,
      lastUpdated: new Date(cached.lastUpdated).toISOString(),
      isFallback: false,
    };
  }

  return {
    ratio: mapping.fallbackRatio,
    futuresPrice: null,
    etfPrice: null,
    etfSymbol: mapping.yahooEtf,
    tvSymbol: mapping.tvSymbol,
    lastUpdated: new Date().toISOString(),
    isFallback: true,
  };
}
