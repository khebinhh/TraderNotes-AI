import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Maximize2, Share2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type FullNote, type TickerData, type PriceRatioData, isFuturesSymbol } from "@/lib/api";

interface LiveChartProps {
  activeTicker: TickerData | null;
  activeNote: FullNote | null;
  priceRatio: PriceRatioData | null;
}

export interface LiveChartHandle {
  syncToLevel: (price: number, label: string, color: string) => void;
}

declare global {
  interface Window {
    TradingView: any;
  }
}

const FUTURES_TV_MAP: Record<string, string> = {
  "ES1!": "AMEX:SPY",
  "NQ1!": "NASDAQ:QQQ",
};

function getChartSymbol(ticker: TickerData): string {
  if (isFuturesSymbol(ticker.symbol)) {
    return FUTURES_TV_MAP[ticker.symbol] || `${ticker.exchange || "COINBASE"}:${ticker.symbol}`;
  }
  return `${ticker.exchange || "COINBASE"}:${ticker.symbol}`;
}

function convertFuturesPrice(futuresPrice: number, ratio: number): number {
  return Math.round((futuresPrice / ratio) * 100) / 100;
}

function parseEventToTimestamp(eventTime: string): number | null {
  const match = eventTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  const now = new Date();
  const eventDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
  return Math.floor(eventDate.getTime() / 1000);
}

export const LiveChart = forwardRef<LiveChartHandle, LiveChartProps>(
  function LiveChart({ activeTicker, activeNote, priceRatio }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetRef = useRef<any>(null);
    const [tvReady, setTvReady] = useState(false);
    const prevSymbolRef = useRef<string | null>(null);
    const chartReadyRef = useRef(false);
    const drawnShapesRef = useRef<any[]>([]);

    useEffect(() => {
      if (document.querySelector('script[src*="tradingview"]')) {
        setTvReady(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = () => setTvReady(true);
      document.head.appendChild(script);
    }, []);

    const clearDrawings = useCallback(() => {
      if (!widgetRef.current || !chartReadyRef.current) return;
      try {
        const chart = widgetRef.current.activeChart();
        drawnShapesRef.current.forEach((id) => {
          try { chart.removeEntity(id); } catch {}
        });
      } catch {}
      drawnShapesRef.current = [];
    }, []);

    const drawLevelLines = useCallback(() => {
      if (!widgetRef.current || !chartReadyRef.current || !activeNote || !activeTicker) return;

      clearDrawings();

      const chart = widgetRef.current.activeChart();
      const isFutures = isFuturesSymbol(activeTicker.symbol);
      const ratio = priceRatio?.ratio || (isFutures ? 10 : 1);

      activeNote.levels.forEach((level) => {
        const rawPrice = parseFloat(level.priceLow);
        if (isNaN(rawPrice)) return;
        const chartPrice = isFutures ? convertFuturesPrice(rawPrice, ratio) : rawPrice;
        const color = level.levelType === "resistance" ? "#f43f5e" : "#10b981";
        const labelSuffix = isFutures ? ` (${activeTicker.symbol}: ${level.priceLow})` : "";

        try {
          const id = chart.createShape(
            { price: chartPrice },
            {
              shape: "horizontal_line",
              lock: true,
              disableSelection: true,
              overrides: {
                linecolor: color,
                linewidth: 1,
                linestyle: 2,
                showLabel: true,
                text: `${level.description || level.levelType}${labelSuffix} — ${chartPrice.toFixed(2)}`,
                textcolor: color,
                fontsize: 10,
                horzLabelsAlign: "right",
                showPrice: false,
              },
            }
          );
          if (id) drawnShapesRef.current.push(id);
        } catch {}

        if (level.priceHigh) {
          const rawHigh = parseFloat(level.priceHigh);
          if (!isNaN(rawHigh)) {
            const chartHigh = isFutures ? convertFuturesPrice(rawHigh, ratio) : rawHigh;
            try {
              const id2 = chart.createShape(
                { price: chartHigh },
                {
                  shape: "horizontal_line",
                  lock: true,
                  disableSelection: true,
                  overrides: {
                    linecolor: color,
                    linewidth: 1,
                    linestyle: 2,
                    showLabel: true,
                    text: `${level.description || level.levelType} High — ${chartHigh.toFixed(2)}`,
                    textcolor: color,
                    fontsize: 10,
                    horzLabelsAlign: "right",
                    showPrice: false,
                  },
                }
              );
              if (id2) drawnShapesRef.current.push(id2);
            } catch {}
          }
        }
      });

      activeNote.events.forEach((evt) => {
        const ts = parseEventToTimestamp(evt.eventTime);
        if (!ts) return;
        try {
          const id = chart.createShape(
            { time: ts },
            {
              shape: "vertical_line",
              lock: true,
              disableSelection: true,
              overrides: {
                linecolor: "#eab308",
                linewidth: 2,
                linestyle: 0,
                showLabel: true,
                text: `${evt.title} ${evt.eventTime}`,
                textcolor: "#eab308",
                fontsize: 10,
              },
            }
          );
          if (id) drawnShapesRef.current.push(id);
        } catch {}
      });
    }, [activeNote, activeTicker, priceRatio, clearDrawings]);

    const syncToLevel = useCallback((price: number, label: string, color: string) => {
      if (!widgetRef.current || !chartReadyRef.current) return;
      try {
        const chart = widgetRef.current.activeChart();
        const id = chart.createShape(
          { price },
          {
            shape: "horizontal_line",
            lock: true,
            disableSelection: true,
            overrides: {
              linecolor: color,
              linewidth: 2,
              linestyle: 0,
              showLabel: true,
              text: `→ ${label} — ${price.toFixed(2)}`,
              textcolor: color,
              fontsize: 12,
              horzLabelsAlign: "left",
              showPrice: true,
            },
          }
        );
        if (id) drawnShapesRef.current.push(id);
      } catch {}
    }, []);

    useImperativeHandle(ref, () => ({ syncToLevel }), [syncToLevel]);

    useEffect(() => {
      if (!tvReady || !containerRef.current || !activeTicker) return;

      const tvSymbol = getChartSymbol(activeTicker);

      if (prevSymbolRef.current === tvSymbol) {
        drawLevelLines();
        return;
      }
      prevSymbolRef.current = tvSymbol;
      chartReadyRef.current = false;

      containerRef.current.innerHTML = "";
      const widgetContainer = document.createElement("div");
      widgetContainer.id = `tv_widget_${activeTicker.id}`;
      widgetContainer.style.width = "100%";
      widgetContainer.style.height = "100%";
      containerRef.current.appendChild(widgetContainer);

      if (window.TradingView) {
        widgetRef.current = new window.TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: "60",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#f1f3f6",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          container_id: widgetContainer.id,
          disabled_features: ["header_compare"],
          overrides: {
            "paneProperties.background": "#0e1116",
            "paneProperties.vertGridProperties.color": "#1e2229",
            "paneProperties.horzGridProperties.color": "#1e2229",
            "scalesProperties.textColor": "#9ca3af",
            "mainSeriesProperties.candleStyle.upColor": "#10b981",
            "mainSeriesProperties.candleStyle.downColor": "#f43f5e",
            "mainSeriesProperties.candleStyle.drawWick": true,
            "mainSeriesProperties.candleStyle.drawBorder": false,
          },
        });

        try {
          if (typeof widgetRef.current.onChartReady === "function") {
            widgetRef.current.onChartReady(() => {
              chartReadyRef.current = true;
              drawLevelLines();
            });
          }
        } catch {}
      }
    }, [tvReady, activeTicker, drawLevelLines]);

    useEffect(() => {
      if (chartReadyRef.current && activeNote) {
        try { drawLevelLines(); } catch {}
      }
    }, [activeNote, priceRatio, drawLevelLines]);

    const isFutures = activeTicker && isFuturesSymbol(activeTicker.symbol);
    const isHistorical = activeNote && activeNote.createdAt &&
      new Date(activeNote.createdAt).toDateString() !== new Date().toDateString();

    return (
      <div className="h-full flex flex-col bg-card">
        <div className="h-10 border-b border-border flex items-center justify-between px-4 bg-card z-10">
          <div className="flex items-center gap-4">
            <span
              className="font-bold font-mono tracking-wider"
              style={{ color: activeTicker?.color || "#f59e0b" }}
              data-testid="text-chart-symbol"
            >
              {activeTicker?.symbol || "---"}
            </span>
            {activeTicker && (
              <div className="flex gap-2">
                <Badge variant="secondary" className="text-[10px] h-5 font-mono">H1</Badge>
                <Badge
                  variant="secondary"
                  className="text-[10px] h-5 font-normal"
                  style={{ color: activeTicker.color || "#f59e0b", borderColor: `${activeTicker.color || "#f59e0b"}33` }}
                >
                  {activeTicker.displayName}
                </Badge>
                {isFutures && priceRatio && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-5 font-mono border-amber-500/30 text-amber-400"
                    data-testid="badge-etf-mapping"
                  >
                    Chart: {priceRatio.etfSymbol} (Ratio: {priceRatio.ratio.toFixed(2)})
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" data-testid="button-share-chart"><Share2 className="h-3 w-3" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" data-testid="button-chart-settings"><Settings className="h-3 w-3" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" data-testid="button-maximize-chart"><Maximize2 className="h-3 w-3" /></Button>
          </div>
        </div>

        <div className="flex-1 relative bg-[#0e1116]">
          <div ref={containerRef} className="absolute inset-0 w-full h-full" />

          {isHistorical && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
              <Badge className="bg-amber-500/90 text-black hover:bg-amber-500 font-bold border-0 shadow-[0_0_20px_rgba(245,158,11,0.4)] animate-in fade-in zoom-in duration-500">
                Historical: {new Date(activeNote!.createdAt).toLocaleDateString()}
              </Badge>
            </div>
          )}

          {!activeTicker && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-muted-foreground font-mono text-sm">Select a ticker to load chart</p>
            </div>
          )}
        </div>
      </div>
    );
  }
);
