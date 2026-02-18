import { useState } from "react";
import { BarChart3, TrendingUp, TrendingDown, Minus, ArrowRight, FileText, X, AlertTriangle, Shield, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TacticalBriefing as TacticalBriefingData } from "@/lib/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TacticalBriefingProps {
  data: TacticalBriefingData;
  onAddToChart?: (price: number, label: string, color: string) => void;
}

const biasConfig: Record<string, { color: string; bg: string; border: string; icon: typeof TrendingUp; label: string }> = {
  "BULLISH": { color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30", icon: TrendingUp, label: "BULLISH" },
  "BULLISH LEAN": { color: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: TrendingUp, label: "BULLISH LEAN" },
  "BEARISH": { color: "text-rose-400", bg: "bg-rose-500/15", border: "border-rose-500/30", icon: TrendingDown, label: "BEARISH" },
  "BEARISH LEAN": { color: "text-rose-300", bg: "bg-rose-500/10", border: "border-rose-500/20", icon: TrendingDown, label: "BEARISH LEAN" },
  "NEUTRAL": { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", icon: Minus, label: "NEUTRAL" },
};

function SentimentMeter({ sentiment }: { sentiment: TacticalBriefingData["sentiment"] }) {
  const config = biasConfig[sentiment.bias] || biasConfig["NEUTRAL"];
  const Icon = config.icon;

  return (
    <div className={cn("rounded-lg border p-3", config.bg, config.border)} data-testid="widget-sentiment">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={cn("h-4 w-4", config.color)} />
        <span className={cn("text-xs font-mono font-bold uppercase tracking-wider", config.color)} data-testid="text-sentiment-bias">
          {config.label}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid="text-sentiment-summary">
        {sentiment.summary}
      </p>
    </div>
  );
}

interface LevelCardProps {
  price: number;
  priceHigh?: number | null;
  label: string;
  source?: string;
  zone: "overhead" | "pivots" | "basins";
  onAddToChart?: (price: number, label: string, color: string) => void;
}

const zoneStyles = {
  overhead: { color: "text-rose-400", bg: "bg-rose-500/8", border: "border-rose-500/25", hoverBg: "hover:bg-rose-500/15", chartColor: "#f43f5e", icon: Target },
  pivots: { color: "text-amber-400", bg: "bg-amber-500/8", border: "border-amber-500/25", hoverBg: "hover:bg-amber-500/15", chartColor: "#f59e0b", icon: AlertTriangle },
  basins: { color: "text-emerald-400", bg: "bg-emerald-500/8", border: "border-emerald-500/25", hoverBg: "hover:bg-emerald-500/15", chartColor: "#10b981", icon: Shield },
};

function LevelCard({ price, priceHigh, label, source, zone, onAddToChart }: LevelCardProps) {
  const style = zoneStyles[zone];
  const Icon = style.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onAddToChart?.(price, label, style.chartColor)}
            className={cn(
              "flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-all",
              "hover:scale-[1.03] active:scale-95 cursor-pointer",
              style.bg, style.border, style.hoverBg
            )}
            data-testid={`button-level-${zone}-${price}`}
          >
            <Icon className={cn("h-3 w-3 shrink-0", style.color)} />
            <span className={cn("font-mono text-[12px] font-bold tabular-nums", style.color)}>
              {price.toLocaleString()}{priceHigh ? `–${priceHigh.toLocaleString()}` : ""}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px]">
          <p className="text-xs font-medium">{label}</p>
          {source && <p className="text-[10px] text-muted-foreground mt-0.5">Source: {source}</p>}
          <p className="text-[10px] text-muted-foreground/60 mt-1">Click to add to chart</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function LevelsGrid({ levels, onAddToChart }: { levels: TacticalBriefingData["levels"]; onAddToChart?: TacticalBriefingProps["onAddToChart"] }) {
  const hasOverhead = levels.overhead && levels.overhead.length > 0;
  const hasPivots = levels.pivots && levels.pivots.length > 0;
  const hasBasins = levels.basins && levels.basins.length > 0;

  if (!hasOverhead && !hasPivots && !hasBasins) return null;

  return (
    <div className="space-y-2.5" data-testid="widget-levels">
      {hasOverhead && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-rose-500" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400/80">Overhead (Resistance)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {levels.overhead.map((l, i) => (
              <LevelCard key={i} price={l.price} priceHigh={l.priceHigh} label={l.label} source={l.source} zone="overhead" onAddToChart={onAddToChart} />
            ))}
          </div>
        </div>
      )}

      {hasPivots && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400/80">Pivots (Decision Zone)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {levels.pivots.map((l, i) => (
              <LevelCard key={i} price={l.price} priceHigh={l.priceHigh} label={l.label} source={l.source} zone="pivots" onAddToChart={onAddToChart} />
            ))}
          </div>
        </div>
      )}

      {hasBasins && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400/80">Basins (Support)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {levels.basins.map((l, i) => (
              <LevelCard key={i} price={l.price} priceHigh={l.priceHigh} label={l.label} source={l.source} zone="basins" onAddToChart={onAddToChart} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function IfThenCards({ scenarios }: { scenarios: TacticalBriefingData["ifThen"] }) {
  if (!scenarios || scenarios.length === 0) return null;

  const getZoneColor = (zone?: string) => {
    if (zone === "green") return "border-emerald-500/25 bg-emerald-500/5";
    if (zone === "red") return "border-rose-500/25 bg-rose-500/5";
    return "border-amber-500/25 bg-amber-500/5";
  };

  const getIfColor = (zone?: string) => {
    if (zone === "red") return "text-rose-400";
    if (zone === "green") return "text-emerald-400";
    return "text-amber-400";
  };

  return (
    <div className="space-y-2" data-testid="widget-ifthen">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
        If / Then Scenarios
      </div>
      {scenarios.map((scenario, i) => (
        <div
          key={i}
          className={cn("rounded-lg border p-3 flex items-start gap-3", getZoneColor(scenario.zone))}
          data-testid={`card-ifthen-${i}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-1.5">
              <span className={cn("text-[10px] font-mono font-bold uppercase shrink-0 mt-0.5", getIfColor(scenario.zone))}>IF</span>
              <p className="text-[11px] text-foreground/90 leading-relaxed">{scenario.condition}</p>
            </div>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-1.5">
              <span className="text-[10px] font-mono font-bold uppercase shrink-0 text-blue-400 mt-0.5">THEN</span>
              <p className="text-[11px] text-foreground/90 leading-relaxed">{scenario.outcome}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceTracer({ sources }: { sources: TacticalBriefingData["sources"] }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div data-testid="widget-sources">
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/40 bg-card/50 text-[10px] text-muted-foreground"
            data-testid={`source-tag-${i}`}
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="font-mono truncate max-w-[150px]">{source.filename}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TacticalBriefing({ data, onAddToChart }: TacticalBriefingProps) {
  return (
    <div className="space-y-3 rounded-lg" data-testid="tactical-briefing">
      {data.bluf && (
        <div className="text-[12px] text-foreground/80 leading-relaxed font-medium border-l-2 border-primary/40 pl-3" data-testid="text-bluf">
          {data.bluf}
        </div>
      )}

      {data.sentiment && <SentimentMeter sentiment={data.sentiment} />}

      {data.levels && <LevelsGrid levels={data.levels} onAddToChart={onAddToChart} />}

      {data.ifThen && <IfThenCards scenarios={data.ifThen} />}

      {data.sources && <SourceTracer sources={data.sources} />}
    </div>
  );
}
