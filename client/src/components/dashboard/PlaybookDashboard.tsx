import { useState } from "react";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Calendar, CheckSquare,
  Square, ChevronDown, ChevronUp, Shield, Zap, Eye, MessageSquare, Save,
  Clock, Star, Filter, History, Users
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type PlaybookData, type Playbook, type PlaybookZoneLevel, type PlaybookScenario,
  type PlaybookEnhancedLevel, type PlaybookEnhancedScenario, type PlaybookMacroClock, type TacticalUpdate
} from "@/lib/api";

interface PlaybookDashboardProps {
  playbook: Playbook;
  onSaveReview?: (id: number, review: string) => void;
  onAddToChart?: (price: number, label: string, color: string) => void;
  isSavingReview?: boolean;
}

function BiasIcon({ bias }: { bias: string }) {
  switch (bias) {
    case "Bullish": return <TrendingUp className="h-5 w-5" />;
    case "Bearish": return <TrendingDown className="h-5 w-5" />;
    default: return <Minus className="h-5 w-5" />;
  }
}

function biasColor(bias: string) {
  switch (bias) {
    case "Bullish": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
    case "Bearish": return "text-rose-400 bg-rose-500/10 border-rose-500/30";
    case "Neutral": return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    default: return "text-blue-400 bg-blue-500/10 border-blue-500/30";
  }
}

function convictionColor(rating: string) {
  if (rating === "A+" || rating === "A") return "border-amber-400/50 text-amber-300 bg-amber-500/10 shadow-[0_0_8px_-2px_rgba(251,191,36,0.3)]";
  if (rating === "B+" || rating === "B") return "border-blue-400/50 text-blue-300 bg-blue-500/10";
  return "border-border text-muted-foreground bg-muted/20";
}

function AuthorBadge({ author }: { author: string }) {
  const isIzzy = author.toLowerCase().includes("izzy");
  const isPharmD = author.toLowerCase().includes("pharmd");
  if (isIzzy && isPharmD) {
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center gap-1 text-[9px] font-mono text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-full border border-violet-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />Izzy
        </span>
        <span className="inline-flex items-center gap-1 text-[9px] font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded-full border border-cyan-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />PharmD
        </span>
      </div>
    );
  }
  if (isIzzy) return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-full border border-violet-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />Ms. Izzy — Ratio Trading
    </span>
  );
  if (isPharmD) return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded-full border border-cyan-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />PharmD_KS — Profile Trading
    </span>
  );
  return (
    <span className="text-[9px] font-mono text-muted-foreground bg-muted/20 px-1.5 py-0.5 rounded-full border border-border">
      <Users className="h-2.5 w-2.5 inline mr-0.5" />{author}
    </span>
  );
}

function MacroClockWidget({ events }: { events: PlaybookMacroClock[] }) {
  if (!events || events.length === 0) return null;
  const riskColor = (risk: string) => {
    switch (risk) {
      case "High": return "border-rose-500/40 bg-rose-500/10 text-rose-400";
      case "Medium": return "border-amber-500/40 bg-amber-500/10 text-amber-400";
      default: return "border-blue-500/40 bg-blue-500/10 text-blue-400";
    }
  };
  return (
    <div className="rounded-xl border border-border bg-card/30 p-4" data-testid="macro-clock">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-4 w-4 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Macro Clock</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {events.map((evt, i) => (
          <div key={i} className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono", riskColor(evt.risk))}>
            <div className={cn("w-2 h-2 rounded-full", evt.risk === "High" ? "bg-rose-500 animate-pulse" : evt.risk === "Medium" ? "bg-amber-500" : "bg-blue-500")} />
            <span className="font-bold">{evt.event}</span>
            <span className="text-muted-foreground">{evt.time}</span>
            <Badge variant="outline" className={cn("text-[8px] ml-1 px-1", riskColor(evt.risk))}>
              {evt.risk}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function EnhancedZoneCard({ level, color, onAddToChart }: {
  level: PlaybookEnhancedLevel | PlaybookZoneLevel;
  color: "green" | "yellow" | "red";
  onAddToChart?: (price: number, label: string, color: string) => void;
}) {
  const colorClasses = {
    green: "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10",
    yellow: "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10",
    red: "border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10",
  };
  const priceColor = {
    green: "text-emerald-400",
    yellow: "text-amber-400",
    red: "text-rose-400",
  };
  const chartColor = { green: "#10b981", yellow: "#f59e0b", red: "#f43f5e" };
  const enhanced = level as PlaybookEnhancedLevel;
  const hasProvenance = enhanced.provenance && enhanced.provenance !== level.label;
  const hasConviction = enhanced.conviction;

  return (
    <div
      className={cn("rounded-lg border p-3 transition-all cursor-pointer", colorClasses[color])}
      onClick={() => onAddToChart?.(level.price, level.label, chartColor[color])}
      data-testid={`zone-card-${color}-${level.price}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className={cn("font-mono font-bold text-sm", priceColor[color])}>
          {level.price}{(level as any).price_high ? `–${(level as any).price_high}` : ""}
        </span>
        <div className="flex items-center gap-1">
          {hasConviction && (
            <span className={cn("text-[8px] font-mono px-1.5 py-0.5 rounded border", convictionColor(enhanced.conviction))}>
              {enhanced.conviction}
            </span>
          )}
          <Zap className={cn("h-3 w-3", priceColor[color])} />
        </div>
      </div>
      <p className="text-xs font-medium text-foreground mb-1">{level.label}</p>
      {hasProvenance && (
        <div className="flex items-center gap-1 mb-1">
          <History className="h-2.5 w-2.5 text-muted-foreground/60" />
          <span className="text-[9px] text-muted-foreground/80 font-mono italic">{enhanced.provenance}</span>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground leading-relaxed">{level.context}</p>
      {level.source && (
        <p className="text-[9px] text-muted-foreground/60 mt-1.5 font-mono">Source: {level.source}</p>
      )}
    </div>
  );
}

function EnhancedScenarioRow({ scenario, checked, onToggle }: {
  scenario: PlaybookScenario | PlaybookEnhancedScenario;
  checked: boolean;
  onToggle: () => void;
}) {
  const enhanced = scenario as PlaybookEnhancedScenario;
  const condition = enhanced.if || (scenario as PlaybookScenario).condition;
  const outcome = enhanced.then || (scenario as PlaybookScenario).outcome;
  const rating = enhanced.rating;
  const crossFilter = enhanced.cross_market_filter;

  const zoneIcon = {
    green: <Shield className="h-3.5 w-3.5 text-emerald-400" />,
    yellow: <Eye className="h-3.5 w-3.5 text-amber-400" />,
    red: <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />,
  };
  const zoneBorder = {
    green: "border-l-emerald-500",
    yellow: "border-l-amber-500",
    red: "border-l-rose-500",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card/30 transition-all border-l-2",
        zoneBorder[scenario.zone],
        checked && "opacity-50"
      )}
      data-testid={`scenario-${scenario.id}`}
    >
      <button onClick={onToggle} className="mt-0.5 shrink-0" data-testid={`toggle-scenario-${scenario.id}`}>
        {checked
          ? <CheckSquare className="h-4 w-4 text-primary" />
          : <Square className="h-4 w-4 text-muted-foreground" />
        }
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {zoneIcon[scenario.zone]}
          <span className={cn("text-xs font-bold", checked && "line-through")}>
            {condition}
          </span>
          {rating && (
            <span className={cn("text-[8px] font-mono px-1.5 py-0.5 rounded border", convictionColor(rating))}>
              {rating}
            </span>
          )}
        </div>
        <p className={cn("text-xs text-muted-foreground", checked && "line-through")}>
          → {outcome}
        </p>
        {crossFilter && (
          <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded bg-orange-500/10 border border-orange-500/20" data-testid="cross-market-filter">
            <Filter className="h-3 w-3 text-orange-400" />
            <span className="text-[10px] font-mono text-orange-300">{crossFilter}</span>
          </div>
        )}
        {scenario.source && (
          <p className="text-[9px] text-muted-foreground/50 mt-1 font-mono">— {scenario.source}</p>
        )}
      </div>
    </div>
  );
}

function TacticalUpdatesLog({ updates }: { updates: TacticalUpdate[] }) {
  if (!updates || updates.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card/30 p-4" data-testid="tactical-updates">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tactical Updates</span>
        <Badge variant="outline" className="text-[9px] ml-auto text-amber-400 border-amber-500/30">{updates.length} updates</Badge>
      </div>
      <div className="space-y-2">
        {updates.map((u, i) => (
          <div key={i} className="flex items-start gap-2 text-[10px] text-muted-foreground border-l-2 border-amber-500/30 pl-3 py-1">
            <div>
              <span className="font-mono text-amber-400">{new Date(u.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="mx-1.5">—</span>
              <span className="text-foreground/80">{u.note}</span>
              {u.addedLevels.length > 0 && <span className="text-emerald-400 ml-1">(+{u.addedLevels.length} levels)</span>}
              {u.addedScenarios.length > 0 && <span className="text-blue-400 ml-1">(+{u.addedScenarios.length} scenarios)</span>}
              <span className="text-muted-foreground/50 ml-1.5">by {u.author}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlaybookDashboard({ playbook, onSaveReview, onAddToChart, isSavingReview }: PlaybookDashboardProps) {
  const data: PlaybookData = playbook.playbookData as PlaybookData;
  const [checkedScenarios, setCheckedScenarios] = useState<Set<string>>(new Set());
  const [showThesis, setShowThesis] = useState(true);
  const [reviewText, setReviewText] = useState(playbook.userReview || "");
  const [showReview, setShowReview] = useState(false);

  const toggleScenario = (id: string) => {
    setCheckedScenarios(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const meta = data.metadata;
  const thesisBias = typeof data.thesis === "object" ? data.thesis.bias : data.bias;
  const thesisSummary = typeof data.thesis === "object" ? data.thesis.summary : data.thesis;
  const enhancedLevels = Array.isArray(data.levels) ? data.levels : [];
  const enhancedScenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
  const macroClock = Array.isArray(data.macro_clock) ? data.macro_clock : [];
  const tacticalUpdates = Array.isArray(data.tactical_updates) ? data.tactical_updates : [];

  const zones = data.structural_zones || { bullish_green: [], neutral_yellow: [], bearish_red: [] };
  const greenLevels = enhancedLevels.length > 0
    ? enhancedLevels.filter(l => l.zone === "green")
    : (Array.isArray(zones.bullish_green) ? zones.bullish_green : []);
  const yellowLevels = enhancedLevels.length > 0
    ? enhancedLevels.filter(l => l.zone === "yellow")
    : (Array.isArray(zones.neutral_yellow) ? zones.neutral_yellow : []);
  const redLevels = enhancedLevels.length > 0
    ? enhancedLevels.filter(l => l.zone === "red")
    : (Array.isArray(zones.bearish_red) ? zones.bearish_red : []);

  const scenarios = enhancedScenarios.length > 0 ? enhancedScenarios : (Array.isArray(data.if_then_scenarios) ? data.if_then_scenarios : []);
  const events = Array.isArray(data.key_events) ? data.key_events : [];
  const risks = Array.isArray(data.risk_factors) ? data.risk_factors : [];
  const checklist = Array.isArray(data.execution_checklist) ? data.execution_checklist : [];

  return (
    <ScrollArea className="h-full">
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        <div className={cn(
          "rounded-xl border p-5 flex items-center justify-between",
          biasColor(thesisBias || data.bias)
        )} data-testid="playbook-banner">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-black/20">
              <BiasIcon bias={thesisBias || data.bias} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <h2 className="text-lg font-bold tracking-wide" data-testid="playbook-bias">
                  {thesisBias || data.bias} Bias
                </h2>
                <Badge variant="outline" className="text-[10px] font-mono border-current/20">
                  {meta?.target_horizon || new Date(playbook.createdAt).toLocaleDateString()}
                </Badge>
                {meta?.horizon_type && (
                  <Badge variant="outline" className="text-[9px] font-mono border-current/20 opacity-70">
                    {meta.horizon_type}
                  </Badge>
                )}
              </div>
              <p className="text-sm opacity-80 font-medium" data-testid="playbook-macro-theme">
                {data.macro_theme || "No macro theme identified"}
              </p>
              {meta?.author && (
                <div className="mt-1.5">
                  <AuthorBadge author={meta.author} />
                </div>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowReview(!showReview)}
            className="gap-1.5 text-xs"
            data-testid="button-toggle-review"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Journal
          </Button>
        </div>

        <MacroClockWidget events={macroClock} />

        {thesisSummary && (
          <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
            <button
              onClick={() => setShowThesis(!showThesis)}
              className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
              data-testid="button-toggle-thesis"
            >
              <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Thesis & Analysis
              </span>
              {showThesis ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showThesis && (
              <div className="px-4 pb-4">
                <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line" data-testid="playbook-thesis">
                  {thesisSummary}
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-primary" />
            Structural Zones
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="structural-zones">
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Bullish Zone</span>
                <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 ml-auto">
                  {greenLevels.length}
                </Badge>
              </div>
              {greenLevels.map((level, i) => (
                <EnhancedZoneCard key={i} level={level} color="green" onAddToChart={onAddToChart} />
              ))}
              {greenLevels.length === 0 && (
                <p className="text-[10px] text-muted-foreground/50 italic p-3">No bullish levels identified</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Neutral Zone</span>
                <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 ml-auto">
                  {yellowLevels.length}
                </Badge>
              </div>
              {yellowLevels.map((level, i) => (
                <EnhancedZoneCard key={i} level={level} color="yellow" onAddToChart={onAddToChart} />
              ))}
              {yellowLevels.length === 0 && (
                <p className="text-[10px] text-muted-foreground/50 italic p-3">No neutral levels identified</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">Bearish Zone</span>
                <Badge variant="outline" className="text-[9px] border-rose-500/30 text-rose-400 ml-auto">
                  {redLevels.length}
                </Badge>
              </div>
              {redLevels.map((level, i) => (
                <EnhancedZoneCard key={i} level={level} color="red" onAddToChart={onAddToChart} />
              ))}
              {redLevels.length === 0 && (
                <p className="text-[10px] text-muted-foreground/50 italic p-3">No bearish levels identified</p>
              )}
            </div>
          </div>
        </div>

        {scenarios.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-primary" />
              If/Then Scenarios
              <Badge variant="outline" className="text-[9px] ml-auto">
                {checkedScenarios.size}/{scenarios.length} triggered
              </Badge>
            </h3>
            <div className="space-y-2" data-testid="if-then-scenarios">
              {scenarios.map((s) => (
                <EnhancedScenarioRow
                  key={s.id}
                  scenario={s}
                  checked={checkedScenarios.has(s.id)}
                  onToggle={() => toggleScenario(s.id)}
                />
              ))}
            </div>
          </div>
        )}

        {events.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              Event Risk
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="key-events">
              {events.map((evt, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card/30">
                  <div className={cn(
                    "mt-0.5 w-2 h-2 rounded-full shrink-0",
                    evt.impact === "high" ? "bg-rose-500" : evt.impact === "medium" ? "bg-amber-500" : "bg-blue-500"
                  )} />
                  <div>
                    <p className="text-xs font-bold text-foreground">{evt.title}</p>
                    <p className="text-[10px] text-muted-foreground">{evt.time}</p>
                    {evt.expected_behavior && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1">{evt.expected_behavior}</p>
                    )}
                  </div>
                  <Badge variant="outline" className={cn(
                    "text-[9px] ml-auto shrink-0",
                    evt.impact === "high" ? "border-rose-500/30 text-rose-400" :
                    evt.impact === "medium" ? "border-amber-500/30 text-amber-400" :
                    "border-blue-500/30 text-blue-400"
                  )}>
                    {evt.impact}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {risks.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              Risk Factors
            </h3>
            <div className="space-y-1.5" data-testid="risk-factors">
              {risks.map((risk, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <p className="text-xs text-foreground/80">{risk}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {checklist.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <CheckSquare className="h-3.5 w-3.5 text-primary" />
              Execution Checklist
            </h3>
            <div className="space-y-1.5" data-testid="execution-checklist">
              {checklist.map((item, i) => (
                <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border/50 bg-card/30">
                  <Square className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-xs text-foreground">{item}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <TacticalUpdatesLog updates={tacticalUpdates} />

        {showReview && (
          <div className="rounded-xl border border-primary/20 bg-card/30 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
              End-of-Day Journal
            </h3>
            <p className="text-[10px] text-muted-foreground mb-3">
              Did the If/Then scenarios play out? What worked, what didn't? Add your review.
            </p>
            <Textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="e.g., The LBAF at 6828 played out perfectly — caught the long to 6860. The OPEX compression thesis was accurate..."
              className="min-h-[100px] text-sm bg-background border-border mb-3"
              data-testid="input-playbook-review"
            />
            <Button
              size="sm"
              onClick={() => onSaveReview?.(playbook.id, reviewText)}
              disabled={isSavingReview || !reviewText.trim()}
              className="gap-1.5"
              data-testid="button-save-review"
            >
              <Save className="h-3.5 w-3.5" />
              {isSavingReview ? "Saving..." : "Save Review"}
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
