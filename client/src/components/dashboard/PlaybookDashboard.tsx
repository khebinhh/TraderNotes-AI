import { useState } from "react";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Calendar, CheckSquare,
  Square, ChevronDown, ChevronUp, Shield, Zap, Eye, MessageSquare, Save
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type PlaybookData, type Playbook, type PlaybookZoneLevel, type PlaybookScenario } from "@/lib/api";

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

function ZoneCard({ level, color, onAddToChart }: {
  level: PlaybookZoneLevel;
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
  const chartColor = {
    green: "#10b981",
    yellow: "#f59e0b",
    red: "#f43f5e",
  };

  return (
    <div
      className={cn("rounded-lg border p-3 transition-all cursor-pointer", colorClasses[color])}
      onClick={() => onAddToChart?.(level.price, level.label, chartColor[color])}
      data-testid={`zone-card-${color}-${level.price}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className={cn("font-mono font-bold text-sm", priceColor[color])}>
          {level.price}{level.price_high ? `–${level.price_high}` : ""}
        </span>
        <Zap className={cn("h-3 w-3", priceColor[color])} />
      </div>
      <p className="text-xs font-medium text-foreground mb-1">{level.label}</p>
      <p className="text-[10px] text-muted-foreground leading-relaxed">{level.context}</p>
      {level.source && (
        <p className="text-[9px] text-muted-foreground/60 mt-1.5 font-mono">Source: {level.source}</p>
      )}
    </div>
  );
}

function ScenarioRow({ scenario, checked, onToggle }: {
  scenario: PlaybookScenario;
  checked: boolean;
  onToggle: () => void;
}) {
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
        <div className="flex items-center gap-2 mb-1">
          {zoneIcon[scenario.zone]}
          <span className={cn("text-xs font-bold", checked && "line-through")}>
            {scenario.condition}
          </span>
        </div>
        <p className={cn("text-xs text-muted-foreground", checked && "line-through")}>
          → {scenario.outcome}
        </p>
        {scenario.source && (
          <p className="text-[9px] text-muted-foreground/50 mt-1 font-mono">— {scenario.source}</p>
        )}
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

  const zones = data.structural_zones || { bullish_green: [], neutral_yellow: [], bearish_red: [] };
  const greenLevels = Array.isArray(zones.bullish_green) ? zones.bullish_green : [];
  const yellowLevels = Array.isArray(zones.neutral_yellow) ? zones.neutral_yellow : [];
  const redLevels = Array.isArray(zones.bearish_red) ? zones.bearish_red : [];
  const scenarios = Array.isArray(data.if_then_scenarios) ? data.if_then_scenarios : [];
  const events = Array.isArray(data.key_events) ? data.key_events : [];
  const risks = Array.isArray(data.risk_factors) ? data.risk_factors : [];
  const checklist = Array.isArray(data.execution_checklist) ? data.execution_checklist : [];

  return (
    <ScrollArea className="h-full">
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        <div className={cn(
          "rounded-xl border p-5 flex items-center justify-between",
          biasColor(data.bias)
        )} data-testid="playbook-banner">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-black/20">
              <BiasIcon bias={data.bias} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-lg font-bold tracking-wide" data-testid="playbook-bias">
                  {data.bias} Bias
                </h2>
                <Badge variant="outline" className="text-[10px] font-mono border-current/20">
                  {new Date(playbook.createdAt).toLocaleDateString()}
                </Badge>
              </div>
              <p className="text-sm opacity-80 font-medium" data-testid="playbook-macro-theme">
                {data.macro_theme || "No macro theme identified"}
              </p>
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

        {data.thesis && (
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
                  {data.thesis}
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
                <ZoneCard key={i} level={level} color="green" onAddToChart={onAddToChart} />
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
                <ZoneCard key={i} level={level} color="yellow" onAddToChart={onAddToChart} />
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
                <ZoneCard key={i} level={level} color="red" onAddToChart={onAddToChart} />
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
                <ScenarioRow
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
