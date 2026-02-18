import { Shield, Target, CheckCircle2, XCircle, ArrowRight, Clock, BookOpen, TrendingUp, TrendingDown, Minus, Activity, Zap, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PostMarketRecap as PostMarketRecapData } from "@/lib/api";

interface PostMarketRecapProps {
  data: PostMarketRecapData;
}

const outcomeConfig: Record<string, { label: string; color: string; bg: string; border: string; icon: typeof Activity; description: string }> = {
  "STABILIZED": { label: "STABILIZED", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", icon: Minus, description: "Price found balance — consolidation day" },
  "TREND_CONTINUATION": { label: "TREND CONTINUATION", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", icon: TrendingUp, description: "Trend extended — directional follow-through" },
  "FAILED_BREAKOUT": { label: "FAILED BREAKOUT", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/30", icon: XCircle, description: "Breakout attempt rejected — reversal in play" },
  "REVERSAL": { label: "REVERSAL", color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/30", icon: RotateCcw, description: "Directional bias flipped during session" },
  "CHOP": { label: "CHOP", color: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/30", icon: Activity, description: "No clean direction — range-bound action" },
};

const gradeColors: Record<string, string> = {
  "A": "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  "B": "text-blue-400 bg-blue-500/15 border-blue-500/30",
  "C": "text-amber-400 bg-amber-500/15 border-amber-500/30",
  "F": "text-rose-400 bg-rose-500/15 border-rose-500/30",
};

function OutcomeBadge({ outcome, closingPrice, morningBias }: { outcome: string; closingPrice: number | null; morningBias: string | null }) {
  const config = outcomeConfig[outcome] || outcomeConfig["CHOP"];
  const Icon = config.icon;

  return (
    <div className={cn("rounded-lg border p-3.5", config.bg, config.border)} data-testid="widget-session-outcome">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4.5 w-4.5", config.color)} />
          <span className={cn("text-sm font-mono font-bold uppercase tracking-wider", config.color)} data-testid="text-session-outcome">
            {config.label}
          </span>
        </div>
        {closingPrice && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-card/80 border border-border/40">
            <span className="text-[10px] font-mono text-muted-foreground uppercase">Close</span>
            <span className="text-sm font-mono font-bold text-foreground tabular-nums" data-testid="text-closing-price">
              {closingPrice.toLocaleString()}
            </span>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{config.description}</p>
      {morningBias && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground/70 font-mono">
          <Clock className="h-3 w-3" />
          Morning bias: <span className="uppercase font-bold">{morningBias}</span>
        </div>
      )}
    </div>
  );
}

function LevelsAudit({ defended, lost }: { defended: PostMarketRecapData["levelsDefended"]; lost: PostMarketRecapData["levelsLost"] }) {
  if (defended.length === 0 && lost.length === 0) return null;

  return (
    <div className="space-y-2.5" data-testid="widget-levels-audit">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
        Levels Audit — Thesis vs. Reality
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="h-3 w-3 text-emerald-400" />
            <span className="text-[10px] font-mono uppercase text-emerald-400/80 tracking-wider">Defended</span>
          </div>
          {defended.length > 0 ? defended.map((l, i) => (
            <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5" data-testid={`level-defended-${l.price}`}>
              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <span className="font-mono text-[12px] font-bold text-emerald-400 tabular-nums">{l.price.toLocaleString()}</span>
                <p className="text-[10px] text-muted-foreground truncate">{l.label}</p>
              </div>
            </div>
          )) : (
            <p className="text-[10px] text-muted-foreground/50 italic px-2">No levels defended</p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="h-3 w-3 text-rose-400" />
            <span className="text-[10px] font-mono uppercase text-rose-400/80 tracking-wider">Lost</span>
          </div>
          {lost.length > 0 ? lost.map((l, i) => (
            <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-rose-500/20 bg-rose-500/5" data-testid={`level-lost-${l.price}`}>
              <XCircle className="h-3 w-3 text-rose-400 shrink-0" />
              <div className="min-w-0">
                <span className="font-mono text-[12px] font-bold text-rose-400 tabular-nums">{l.price.toLocaleString()}</span>
                <p className="text-[10px] text-muted-foreground truncate">{l.label}</p>
              </div>
            </div>
          )) : (
            <p className="text-[10px] text-muted-foreground/50 italic px-2">No levels lost</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ScenariosTriggered({ scenarios }: { scenarios: PostMarketRecapData["scenariosTriggered"] }) {
  if (!scenarios || scenarios.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="widget-scenarios-triggered">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
        Scenarios Triggered
      </div>
      {scenarios.map((s, i) => (
        <div key={i} className="rounded-lg border border-border/40 bg-card/30 p-3" data-testid={`scenario-triggered-${i}`}>
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="text-[11px] text-foreground/80 leading-relaxed flex-1">{s.scenario}</p>
            <span className={cn("text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0", gradeColors[s.grade] || gradeColors["C"])} data-testid={`scenario-grade-${i}`}>
              {s.grade}
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <ArrowRight className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-foreground leading-relaxed">{s.result}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PrepForTomorrow({ prep }: { prep: string }) {
  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3" data-testid="widget-prep-tomorrow">
      <div className="flex items-center gap-1.5 mb-2">
        <Zap className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400/80">Prep for Tomorrow</span>
      </div>
      <p className="text-[11px] text-foreground/80 leading-relaxed">{prep}</p>
    </div>
  );
}

function LessonOfTheDay({ lesson }: { lesson: string }) {
  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3" data-testid="widget-lesson">
      <div className="flex items-center gap-1.5 mb-2">
        <BookOpen className="h-3.5 w-3.5 text-violet-400" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-violet-400/80">Lesson of the Day</span>
      </div>
      <p className="text-[11px] text-foreground/80 leading-relaxed italic">"{lesson}"</p>
    </div>
  );
}

export function PostMarketRecap({ data }: PostMarketRecapProps) {
  return (
    <div className="space-y-3 rounded-lg" data-testid="post-market-recap">
      <div className="flex items-center gap-2 mb-1">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-400/60">Post-Market Review</span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
      </div>

      <OutcomeBadge outcome={data.sessionOutcome} closingPrice={data.closingPrice} morningBias={data.morningBias} />

      <LevelsAudit defended={data.levelsDefended} lost={data.levelsLost} />

      <ScenariosTriggered scenarios={data.scenariosTriggered} />

      {data.prepForTomorrow && <PrepForTomorrow prep={data.prepForTomorrow} />}

      {data.lessonOfTheDay && <LessonOfTheDay lesson={data.lessonOfTheDay} />}
    </div>
  );
}