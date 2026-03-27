import { useState, useMemo, memo, useRef, useCallback } from "react";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Calendar, CheckSquare,
  Square, ChevronDown, ChevronUp, Shield, Zap, Eye, MessageSquare, Save,
  Clock, Star, Filter, History, Users, Trash2, ChevronsUpDown, Layers,
  Ruler, Timer, AlertOctagon, Target, Printer, FileDown, Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  type PlaybookData, type Playbook, type PlaybookZoneLevel, type PlaybookScenario,
  type PlaybookEnhancedLevel, type PlaybookEnhancedScenario, type PlaybookMacroClock, type TacticalUpdate,
  type PlaybookStrategyRule, type InstrumentPlaybookData, normalizeTickerSymbol, getInstrumentData
} from "@/lib/api";

interface PlaybookDashboardProps {
  playbook: Playbook;
  activeTickerSymbol?: string;
  onSaveReview?: (id: number, review: string) => void;
  onAddToChart?: (price: number, label: string, color: string) => void;
  onDelete?: (id: number) => void;
  isSavingReview?: boolean;
  isDeleting?: boolean;
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
  if (rating === "A+" || rating === "A") return "border-amber-400/50 text-amber-300 bg-amber-500/10 shadow-[0_0_8px_-2px_rgba(251,191,36,0.3)] conviction-glow";
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

function AuthorInitialsDot({ initials }: { initials: string }) {
  const hasIzzy = initials.includes("I");
  const hasPharmD = initials.includes("P");
  const isBoth = hasIzzy && hasPharmD;

  if (isBoth) {
    return (
      <div className="flex items-center gap-0.5" title="Sources: Ms. Izzy + PharmD_KS">
        <span className="w-2 h-2 rounded-full bg-violet-400 border border-violet-300/50" />
        <span className="w-2 h-2 rounded-full bg-cyan-400 border border-cyan-300/50" />
      </div>
    );
  }
  if (hasIzzy) {
    return <span className="w-2 h-2 rounded-full bg-violet-400 border border-violet-300/50" title="Source: Ms. Izzy" />;
  }
  if (hasPharmD) {
    return <span className="w-2 h-2 rounded-full bg-cyan-400 border border-cyan-300/50" title="Source: PharmD_KS" />;
  }
  return (
    <span className="text-[8px] font-mono text-muted-foreground/50 px-1 py-0.5 rounded bg-muted/20" title={`Source: ${initials}`}>
      {initials}
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
          <div key={i} className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono min-h-[44px]", riskColor(evt.risk))}>
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

function StrategyRulesWidget({ rules }: { rules: PlaybookStrategyRule[] }) {
  if (!rules || rules.length === 0) return null;
  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4" data-testid="strategy-rules">
      <div className="flex items-center gap-2 mb-3">
        <Ruler className="h-4 w-4 text-violet-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Math Anchors</span>
        <Badge variant="outline" className="text-[9px] ml-auto text-violet-400 border-violet-500/30">{rules.length} rules</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {rules.map((rule, i) => (
          <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-3 py-2.5 rounded-lg border border-violet-500/20 bg-violet-500/10 text-xs font-mono" data-testid={`strategy-rule-${i}`}>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
              <span className="font-bold text-violet-300">{rule.label}:</span>
              <span className="text-violet-200 font-bold">{rule.value}</span>
            </div>
            <span className="text-muted-foreground/70 text-[10px] font-normal sm:max-w-[300px]">{rule.description}</span>
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
  const isUpsideTarget = enhanced.type && /upside target|calculated high|annual high/i.test(enhanced.type);
  const isRTH = enhanced.provenance && /\bRTH\b/i.test(enhanced.provenance);
  const isETH = enhanced.provenance && /\bETH\b/i.test(enhanced.provenance);
  const isConfluence = enhanced.is_confluence === true;
  const authorInitials = enhanced.author_initials;

  return (
    <motion.div
      className={cn(
        "rounded-lg border p-3 cursor-pointer relative min-h-[44px] gpu-accelerated",
        colorClasses[color],
        isConfluence && "ring-1 ring-amber-400/40 shadow-[0_0_12px_-3px_rgba(251,191,36,0.25)]"
      )}
      onClick={() => onAddToChart?.(level.price, level.label, chartColor[color])}
      data-testid={`zone-card-${color}-${level.price}`}
      whileHover={{ scale: 1.02, borderColor: "rgba(255,255,255,0.15)" }}
      transition={{ duration: 0.1 }}
    >
      {isConfluence && (
        <div className="absolute -top-2 -right-2 z-10" data-testid="confluence-badge">
          <motion.span
            className="inline-flex items-center gap-1 text-[7px] font-bold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/50 shadow-[0_0_8px_-2px_rgba(251,191,36,0.4)] gpu-accelerated"
            title={enhanced.sources ? `Multiple experts identified this area. Sources: ${enhanced.sources.join(", ")}` : "Confluence zone"}
            animate={{
              boxShadow: [
                "0 0 8px -2px rgba(251,191,36,0.4)",
                "0 0 16px -2px rgba(251,191,36,0.6)",
                "0 0 8px -2px rgba(251,191,36,0.4)",
              ],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <Layers className="h-2.5 w-2.5" />
            CONFLUENCE
          </motion.span>
        </div>
      )}
      <div className="flex items-center justify-between mb-1.5">
        <span className={cn("font-mono font-bold text-sm", priceColor[color])}>
          {level.price}{(level as any).price_high ? `–${(level as any).price_high}` : ""}
        </span>
        <div className="flex items-center gap-1">
          {isUpsideTarget && (
            <span className="text-[7px] font-mono px-1 py-0.5 rounded border border-emerald-400/40 text-emerald-300 bg-emerald-500/10">
              TARGET
            </span>
          )}
          {(isRTH || isETH) && (
            <span className={cn("text-[7px] font-mono px-1 py-0.5 rounded border",
              isRTH ? "border-blue-400/40 text-blue-300 bg-blue-500/10" : "border-purple-400/40 text-purple-300 bg-purple-500/10"
            )}>
              {isRTH ? "RTH" : "ETH"}
            </span>
          )}
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
      <div className="flex items-center justify-between mt-1.5">
        {level.source && (
          <p className="text-[9px] text-muted-foreground/60 font-mono">Source: {level.source}</p>
        )}
        {authorInitials && (
          <AuthorInitialsDot initials={authorInitials} />
        )}
      </div>
    </motion.div>
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
  const timingReq = enhanced.timing_requirement || (scenario as any).timing_requirement;
  const isConfluence = enhanced.is_confluence === true;
  const authorInitials = enhanced.author_initials;

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
        "flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card/30 transition-all border-l-2 relative",
        zoneBorder[scenario.zone],
        checked && "opacity-50",
        isConfluence && "ring-1 ring-amber-400/40 shadow-[0_0_12px_-3px_rgba(251,191,36,0.25)]"
      )}
      data-testid={`scenario-${scenario.id}`}
    >
      {isConfluence && (
        <div className="absolute -top-2 -right-2 z-10" data-testid="scenario-confluence-badge">
          <span className="inline-flex items-center gap-1 text-[7px] font-bold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/50 shadow-[0_0_8px_-2px_rgba(251,191,36,0.4)]" title={enhanced.sources ? `Multiple experts identified this area. Sources: ${enhanced.sources.join(", ")}` : "Confluence scenario"}>
            <Layers className="h-2.5 w-2.5" />
            CONFLUENCE
          </span>
        </div>
      )}
      <button onClick={onToggle} className="mt-0.5 shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center" data-testid={`toggle-scenario-${scenario.id}`}>
        {checked
          ? <CheckSquare className="h-4 w-4 text-primary" />
          : <Square className="h-4 w-4 text-muted-foreground" />
        }
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {zoneIcon[scenario.zone]}
          <motion.span
            className={cn("text-xs font-bold", checked && "checklist-checked")}
            animate={{ opacity: checked ? 0.5 : 1, filter: checked ? "saturate(0.3)" : "saturate(1)" }}
            transition={{ duration: 0.3 }}
          >
            {condition}
          </motion.span>
          {rating && (
            <span className={cn("text-[8px] font-mono px-1.5 py-0.5 rounded border", convictionColor(rating))}>
              {rating}
            </span>
          )}
        </div>
        <motion.p
          className={cn("text-xs text-muted-foreground", checked && "checklist-checked")}
          animate={{ opacity: checked ? 0.5 : 1, filter: checked ? "saturate(0.3)" : "saturate(1)" }}
          transition={{ duration: 0.3 }}
        >
          → {outcome}
        </motion.p>
        {crossFilter && (
          <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded bg-orange-500/10 border border-orange-500/20" data-testid="cross-market-filter">
            <Filter className="h-3 w-3 text-orange-400" />
            <span className="text-[10px] font-mono text-orange-300">{crossFilter}</span>
          </div>
        )}
        {timingReq && (
          <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded bg-rose-500/10 border border-rose-500/20 animate-pulse" data-testid="timing-requirement">
            <Timer className="h-3 w-3 text-rose-400" />
            <span className="text-[10px] font-mono font-bold text-rose-300">{timingReq}</span>
          </div>
        )}
        <div className="flex items-center justify-between mt-1">
          {scenario.source && (
            <p className="text-[9px] text-muted-foreground/50 font-mono">— {scenario.source}</p>
          )}
          {authorInitials && (
            <AuthorInitialsDot initials={authorInitials} />
          )}
        </div>
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

function CollapsibleSection({ title, icon, count, isOpen, onToggle, children, color, testId }: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  color?: string;
  testId?: string;
}) {
  return (
    <motion.div
      className="rounded-xl border border-border bg-card/30 overflow-hidden gpu-accelerated"
      data-testid={testId}
      layout
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors min-h-[44px]"
        data-testid={testId ? `button-toggle-${testId}` : undefined}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
          {count !== undefined && (
            <Badge variant="outline" className={cn("text-[9px]", color || "border-border text-muted-foreground")}>
              {count} {count === 1 ? "item" : "items"}
            </Badge>
          )}
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="gpu-accelerated"
            style={{ overflow: "hidden" }}
          >
            <div className="px-4 pb-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}


export const PlaybookDashboard = memo(function PlaybookDashboard({ playbook, activeTickerSymbol, onSaveReview, onAddToChart, onDelete, isSavingReview, isDeleting }: PlaybookDashboardProps) {
  const isMobile = useIsMobile();
  const data: PlaybookData = playbook.playbookData as PlaybookData;
  const { toast } = useToast();
  const [checkedScenarios, setCheckedScenarios] = useState<Set<string>>(new Set());
  const [reviewText, setReviewText] = useState(playbook.userReview || "");
  const [showReview, setShowReview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showOnlyConfluence, setShowOnlyConfluence] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const [sectionState, setSectionState] = useState<Record<string, boolean>>(() => {
    return {
      thesis: true,
      zones: false,
      scenarios: true,
      events: true,
      risks: true,
      checklist: true,
    };
  });

  const toggleScenario = (id: string) => {
    setCheckedScenarios(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const instrumentData = useMemo(() => {
    if (!activeTickerSymbol || !data.instruments) return null;
    return getInstrumentData(data, activeTickerSymbol);
  }, [data, activeTickerSymbol]);

  const availableInstruments = useMemo(() => {
    if (!data.instruments) return [];
    return Object.keys(data.instruments);
  }, [data]);

  const hasMultipleInstruments = availableInstruments.length > 1;
  const activeNormalized = activeTickerSymbol ? normalizeTickerSymbol(activeTickerSymbol) : null;

  const effectiveBias = instrumentData?.bias || (typeof data.thesis === "object" ? data.thesis.bias : data.bias);
  const effectiveThesis = instrumentData?.thesis || data.thesis;
  const effectiveMacroTheme = instrumentData?.macro_theme || data.macro_theme;

  const thesisBias = typeof effectiveThesis === "object" ? effectiveThesis.bias : effectiveBias;
  const thesisSummary = typeof effectiveThesis === "object" ? effectiveThesis.summary : effectiveThesis;

  const enhancedLevels = useMemo(() => {
    if (instrumentData) return instrumentData.levels || [];
    const allLevels = Array.isArray(data.levels) ? data.levels : [];
    if (!activeNormalized || !hasMultipleInstruments) return allLevels;
    return allLevels.filter(l => {
      const inst = (l as any).instrument;
      if (inst) return normalizeTickerSymbol(inst) === activeNormalized;
      return true;
    });
  }, [instrumentData, data.levels, activeNormalized, hasMultipleInstruments]);

  const enhancedScenarios = useMemo(() => {
    if (instrumentData) return instrumentData.scenarios || [];
    const allScenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
    if (!activeNormalized || !hasMultipleInstruments) return allScenarios;
    return allScenarios.filter(s => {
      const inst = (s as any).instrument;
      if (inst) return normalizeTickerSymbol(inst) === activeNormalized;
      return true;
    });
  }, [instrumentData, data.scenarios, activeNormalized, hasMultipleInstruments]);

  const macroClock = Array.isArray(data.shared?.macro_clock) ? data.shared.macro_clock
    : Array.isArray(data.macro_clock) ? data.macro_clock : [];
  const tacticalUpdates = Array.isArray(data.tactical_updates) ? data.tactical_updates : [];
  const strategyRules = instrumentData?.strategy_rules || (Array.isArray(data.strategy_rules) ? data.strategy_rules : []);

  const zones = data.structural_zones || { bullish_green: [], neutral_yellow: [], bearish_red: [] };
  const greenLevels = useMemo(() => enhancedLevels.length > 0
    ? enhancedLevels.filter(l => l.zone === "green")
    : (Array.isArray(zones.bullish_green) ? zones.bullish_green : []), [enhancedLevels, zones.bullish_green]);
  const yellowLevels = useMemo(() => enhancedLevels.length > 0
    ? enhancedLevels.filter(l => l.zone === "yellow")
    : (Array.isArray(zones.neutral_yellow) ? zones.neutral_yellow : []), [enhancedLevels, zones.neutral_yellow]);
  const redLevels = useMemo(() => enhancedLevels.length > 0
    ? enhancedLevels.filter(l => l.zone === "red")
    : (Array.isArray(zones.bearish_red) ? zones.bearish_red : []), [enhancedLevels, zones.bearish_red]);

  const filteredGreen = useMemo(() => showOnlyConfluence ? greenLevels.filter(item => (item as any).is_confluence === true) : greenLevels, [showOnlyConfluence, greenLevels]);
  const filteredYellow = useMemo(() => showOnlyConfluence ? yellowLevels.filter(item => (item as any).is_confluence === true) : yellowLevels, [showOnlyConfluence, yellowLevels]);
  const filteredRed = useMemo(() => showOnlyConfluence ? redLevels.filter(item => (item as any).is_confluence === true) : redLevels, [showOnlyConfluence, redLevels]);
  const totalLevels = filteredGreen.length + filteredYellow.length + filteredRed.length;

  const allScenarios = useMemo(() => enhancedScenarios.length > 0 ? enhancedScenarios : (Array.isArray(data.if_then_scenarios) ? data.if_then_scenarios : []), [enhancedScenarios, data.if_then_scenarios]);
  const scenarios = useMemo(() => showOnlyConfluence ? allScenarios.filter(item => (item as any).is_confluence === true) : allScenarios, [showOnlyConfluence, allScenarios]);

  const { totalConfluence, hasAnyConfluence } = useMemo(() => {
    const confluenceLevelCount = [...greenLevels, ...yellowLevels, ...redLevels].filter(l => (l as any).is_confluence === true).length;
    const confluenceScenarioCount = allScenarios.filter(s => (s as any).is_confluence === true).length;
    const total = confluenceLevelCount + confluenceScenarioCount;
    return { totalConfluence: total, hasAnyConfluence: total > 0 };
  }, [greenLevels, yellowLevels, redLevels, allScenarios]);
  const events = Array.isArray(data.shared?.key_events) ? data.shared.key_events
    : Array.isArray(data.key_events) ? data.key_events : [];
  const risks = Array.isArray(data.shared?.risk_factors) ? data.shared.risk_factors
    : Array.isArray(data.risk_factors) ? data.risk_factors : [];
  const checklist = useMemo(() => instrumentData?.execution_checklist || (Array.isArray(data.execution_checklist) ? data.execution_checklist : []), [instrumentData, data.execution_checklist]);

  const sortedChecklist = useMemo(() => {
    return checklist.slice().sort((a, b) => {
      const aTime = /no later than|before|deadline|by the|urgent|time.?sensitive/i.test(a) ? -1 : 0;
      const bTime = /no later than|before|deadline|by the|urgent|time.?sensitive/i.test(b) ? -1 : 0;
      return aTime - bTime;
    });
  }, [checklist]);

  const meta = data.metadata;

  const allExpanded = Object.values(sectionState).every(v => v);

  const toggleSection = (key: string) => {
    setSectionState(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAll = () => {
    const newState = !allExpanded;
    setSectionState({
      thesis: newState,
      zones: newState,
      scenarios: newState,
      events: newState,
      risks: newState,
      checklist: newState,
    });
  };

  const handlePrint = () => {
    const ticker = activeTickerSymbol || "Ticker";
    const date = playbook.targetDateStart || new Date().toISOString().split("T")[0];
    const originalTitle = document.title;
    document.title = `TraderNotes_Playbook_${ticker}_${date}`;
    window.print();
    document.title = originalTitle;
  };

  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const handleExportPDF = async () => {
    if (!reportRef.current || isExportingPDF) return;
    setIsExportingPDF(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: html2canvas } = await import("html2canvas");
      const ticker = activeTickerSymbol || "Ticker";
      const date = playbook.targetDateStart || new Date().toISOString().split("T")[0];
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#0D0D0D",
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let yOffset = 0;
      let remaining = imgHeight;
      while (remaining > 0) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, -yOffset, imgWidth, imgHeight);
        yOffset += pageHeight;
        remaining -= pageHeight;
      }
      pdf.save(`TraderNotes_Playbook_${ticker}_${date}.pdf`);
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setIsExportingPDF(false);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div ref={reportRef} className={cn("max-w-4xl mx-auto space-y-6 relative print-region", isMobile ? "p-3" : "p-6")}>
        <div className="print-header">
          <span className="print-header-left">TRADERNOTES AI</span>
          <span className="print-header-right">
            {[activeTickerSymbol, playbook.targetDateStart].filter(Boolean).join(" | ")}
          </span>
        </div>

        <div className={cn(
          "rounded-xl border",
          isMobile ? "p-3" : "p-5",
          biasColor(thesisBias || data.bias)
        )} data-testid="playbook-banner">
          <div className={cn("flex", isMobile ? "flex-col gap-3" : "items-center justify-between")}>
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="p-2.5 rounded-lg bg-black/20 shrink-0">
                <BiasIcon bias={thesisBias || data.bias} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <h2 className={cn("font-bold tracking-wide", isMobile ? "text-base" : "text-lg")} data-testid="playbook-bias">
                    {thesisBias || data.bias} Bias
                  </h2>
                  {activeNormalized && hasMultipleInstruments && (
                    <Badge className="text-[10px] font-mono bg-primary/20 text-primary border-primary/30">
                      {activeNormalized}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] font-mono border-current/20">
                    {meta?.target_horizon || new Date(playbook.createdAt).toLocaleDateString()}
                  </Badge>
                  {meta?.horizon_type && (
                    <Badge variant="outline" className="text-[9px] font-mono border-current/20 opacity-70">
                      {meta.horizon_type}
                    </Badge>
                  )}
                  <span className="flex items-center gap-1 text-[9px] text-emerald-400/80 font-mono" data-testid="data-sync-indicator">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Synced
                  </span>
                  {meta?.sentiment_warning && (
                    <Badge className="text-[9px] font-mono bg-orange-500/20 text-orange-300 border border-orange-500/40 animate-pulse gap-1" data-testid="sentiment-warning">
                      <AlertOctagon className="h-3 w-3" />
                      {meta.sentiment_warning}
                    </Badge>
                  )}
                </div>
                <p className="text-sm opacity-80 font-medium" data-testid="playbook-macro-theme">
                  {effectiveMacroTheme || "No macro theme identified"}
                </p>
                {meta?.author && (
                  <div className="mt-1.5">
                    <AuthorBadge author={meta.author} />
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {hasAnyConfluence && (
                <Button
                  variant={showOnlyConfluence ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setShowOnlyConfluence(!showOnlyConfluence)}
                  className={cn(
                    "gap-1.5 text-xs min-h-[44px]",
                    showOnlyConfluence
                      ? "bg-amber-500/20 text-amber-300 border border-amber-400/50 hover:bg-amber-500/30"
                      : "text-muted-foreground"
                  )}
                  data-testid="button-confluence-filter"
                >
                  <Layers className="h-3.5 w-3.5" />
                  {showOnlyConfluence ? `Confluence (${totalConfluence})` : "Show Only Confluence"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleAll}
                className="gap-1.5 text-xs text-muted-foreground min-h-[44px]"
                data-testid="button-toggle-all"
              >
                <ChevronsUpDown className="h-3.5 w-3.5" />
                {allExpanded ? "Collapse" : "Expand"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowReview(!showReview)}
                className="gap-1.5 text-xs min-h-[44px]"
                data-testid="button-toggle-review"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Journal
              </Button>
            </div>
          </div>
        </div>

        {hasMultipleInstruments && (
          <div className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-card/30" data-testid="instrument-indicator">
            <Layers className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] text-muted-foreground font-mono">
              Multi-instrument playbook:
            </span>
            {availableInstruments.map(sym => (
              <Badge
                key={sym}
                variant="outline"
                className={cn(
                  "text-[9px] font-mono",
                  sym === activeNormalized
                    ? "border-primary/50 text-primary bg-primary/10"
                    : "border-border text-muted-foreground"
                )}
              >
                {sym}
                {sym === activeNormalized && " (active)"}
              </Badge>
            ))}
          </div>
        )}

        <MacroClockWidget events={macroClock} />

        <StrategyRulesWidget rules={strategyRules} />

        {thesisSummary && (
          <CollapsibleSection
            title="Thesis & Analysis"
            icon={<Eye className="h-3.5 w-3.5 text-primary" />}
            isOpen={sectionState.thesis}
            onToggle={() => toggleSection("thesis")}
            testId="section-thesis"
          >
            <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line" data-testid="playbook-thesis">
              {thesisSummary}
            </div>
          </CollapsibleSection>
        )}

        <CollapsibleSection
          title="Structural Zones"
          icon={<Zap className="h-3.5 w-3.5 text-primary" />}
          count={totalLevels}
          isOpen={sectionState.zones}
          onToggle={() => toggleSection("zones")}
          testId="section-structural-zones"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="structural-zones">
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Bullish Zone</span>
                <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 ml-auto">
                  {filteredGreen.length}
                </Badge>
              </div>
              {filteredGreen.map((level, i) => (
                <EnhancedZoneCard key={i} level={level} color="green" onAddToChart={onAddToChart} />
              ))}
              {filteredGreen.length === 0 && (
                <p className="text-[10px] text-muted-foreground/50 italic p-3">{showOnlyConfluence ? "No confluence levels" : "No bullish levels identified"}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Neutral Zone</span>
                <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 ml-auto">
                  {filteredYellow.length}
                </Badge>
              </div>
              {filteredYellow.map((level, i) => (
                <EnhancedZoneCard key={i} level={level} color="yellow" onAddToChart={onAddToChart} />
              ))}
              {filteredYellow.length === 0 && (
                <p className="text-[10px] text-muted-foreground/50 italic p-3">{showOnlyConfluence ? "No confluence levels" : "No neutral levels identified"}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">Bearish Zone</span>
                <Badge variant="outline" className="text-[9px] border-rose-500/30 text-rose-400 ml-auto">
                  {filteredRed.length}
                </Badge>
              </div>
              {filteredRed.map((level, i) => (
                <EnhancedZoneCard key={i} level={level} color="red" onAddToChart={onAddToChart} />
              ))}
              {filteredRed.length === 0 && (
                <p className="text-[10px] text-muted-foreground/50 italic p-3">{showOnlyConfluence ? "No confluence levels" : "No bearish levels identified"}</p>
              )}
            </div>
          </div>
        </CollapsibleSection>

        {(() => {
          const counterTrendPattern = /laaf|lbaf|failed\s*reclaim|counter.?trend|trap|false\s*break|fake.?out|stop\s*hunt/i;
          const isCounterTrend = (s: any) => {
            if (s.plan_type === "counter_trend") return true;
            const ifText = s.if || s.condition || "";
            const thenText = s.then || s.outcome || "";
            return counterTrendPattern.test(ifText) || counterTrendPattern.test(thenText);
          };

          const primaryScenarios = scenarios.filter(s => {
            const pt = (s as any).plan_type;
            return pt === "primary" && !isCounterTrend(s);
          });
          const counterTrendScenarios = scenarios.filter(s => isCounterTrend(s));
          const contingencyScenarios = scenarios.filter(s => {
            const pt = (s as any).plan_type;
            return pt === "contingency" && !isCounterTrend(s);
          });
          const categorized = new Set([...primaryScenarios, ...counterTrendScenarios, ...contingencyScenarios]);
          const remaining = scenarios.filter(s => !categorized.has(s));
          const hasGrouping = primaryScenarios.length > 0 || counterTrendScenarios.length > 0 || contingencyScenarios.length > 0;

          return (
            <CollapsibleSection
              title="If/Then Scenarios"
              icon={<Shield className="h-3.5 w-3.5 text-primary" />}
              count={scenarios.length}
              isOpen={sectionState.scenarios}
              onToggle={() => toggleSection("scenarios")}
              testId="section-scenarios"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[9px]">
                    {checkedScenarios.size}/{scenarios.length} triggered
                  </Badge>
                  {hasGrouping && (
                    <>
                      {primaryScenarios.length > 0 && (
                        <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400">
                          {primaryScenarios.length} primary
                        </Badge>
                      )}
                      {counterTrendScenarios.length > 0 && (
                        <Badge variant="outline" className="text-[9px] border-rose-500/30 text-rose-400">
                          {counterTrendScenarios.length} traps
                        </Badge>
                      )}
                      {contingencyScenarios.length > 0 && (
                        <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                          {contingencyScenarios.length} contingency
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-4" data-testid="if-then-scenarios">
                {hasGrouping ? (
                  <>
                    {primaryScenarios.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-emerald-500/20">
                          <Target className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Primary Plan</span>
                          <span className="text-[9px] text-muted-foreground/50 font-mono">Author's most likely path</span>
                        </div>
                        <div className="space-y-2">
                          {primaryScenarios.map((s) => (
                            <EnhancedScenarioRow key={s.id} scenario={s} checked={checkedScenarios.has(s.id)} onToggle={() => toggleScenario(s.id)} />
                          ))}
                        </div>
                      </div>
                    )}
                    {counterTrendScenarios.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-rose-500/20">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">Counter-Trend / Traps</span>
                          <span className="text-[9px] text-muted-foreground/50 font-mono">LAAF/LBAF setups</span>
                        </div>
                        <div className="space-y-2">
                          {counterTrendScenarios.map((s) => (
                            <EnhancedScenarioRow key={s.id} scenario={s} checked={checkedScenarios.has(s.id)} onToggle={() => toggleScenario(s.id)} />
                          ))}
                        </div>
                      </div>
                    )}
                    {contingencyScenarios.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-amber-500/20">
                          <Shield className="h-3.5 w-3.5 text-amber-400" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Contingency Plans</span>
                          <span className="text-[9px] text-muted-foreground/50 font-mono">Floor / yearly level breaks</span>
                        </div>
                        <div className="space-y-2">
                          {contingencyScenarios.map((s) => (
                            <EnhancedScenarioRow key={s.id} scenario={s} checked={checkedScenarios.has(s.id)} onToggle={() => toggleScenario(s.id)} />
                          ))}
                        </div>
                      </div>
                    )}
                    {remaining.length > 0 && (
                      <div className="space-y-2">
                        {remaining.map((s) => (
                          <EnhancedScenarioRow key={s.id} scenario={s} checked={checkedScenarios.has(s.id)} onToggle={() => toggleScenario(s.id)} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    {scenarios.map((s) => (
                      <EnhancedScenarioRow key={s.id} scenario={s} checked={checkedScenarios.has(s.id)} onToggle={() => toggleScenario(s.id)} />
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleSection>
          );
        })()}

        {events.length > 0 && (
          <CollapsibleSection
            title="Event Risk"
            icon={<Calendar className="h-3.5 w-3.5 text-primary" />}
            count={events.length}
            isOpen={sectionState.events}
            onToggle={() => toggleSection("events")}
            testId="section-events"
          >
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
          </CollapsibleSection>
        )}

        {risks.length > 0 && (
          <CollapsibleSection
            title="Risk Factors"
            icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
            count={risks.length}
            isOpen={sectionState.risks}
            onToggle={() => toggleSection("risks")}
            testId="section-risks"
          >
            <div className="space-y-1.5" data-testid="risk-factors">
              {risks.map((risk, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <p className="text-xs text-foreground/80">{risk}</p>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {checklist.length > 0 && (
          <CollapsibleSection
            title="Execution Checklist"
            icon={<CheckSquare className="h-3.5 w-3.5 text-primary" />}
            count={checklist.length}
            isOpen={sectionState.checklist}
            onToggle={() => toggleSection("checklist")}
            testId="section-checklist"
          >
            <div className="space-y-1.5" data-testid="execution-checklist">
              {sortedChecklist.map((item, i) => {
                  const isTimeSensitive = /no later than|before|deadline|by the|urgent|time.?sensitive/i.test(item);
                  return (
                    <div key={i} className={cn(
                      "flex items-start gap-2.5 p-2.5 rounded-lg border",
                      isTimeSensitive
                        ? "border-rose-500/30 bg-rose-500/5"
                        : "border-border/50 bg-card/30"
                    )}>
                      {isTimeSensitive ? (
                        <Timer className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0 animate-pulse" />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1">
                        <p className={cn("text-xs", isTimeSensitive ? "text-rose-300 font-bold" : "text-foreground")}>{item}</p>
                        {isTimeSensitive && (
                          <span className="text-[9px] font-mono text-rose-400/70 mt-0.5 block">TIME-SENSITIVE</span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </CollapsibleSection>
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

        <div className="flex justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="font-mono text-xs tracking-wide border-muted-foreground/30 text-muted-foreground hover:text-foreground no-print"
            data-testid="button-print-playbook"
          >
            <Printer className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            PRINT
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPDF}
            disabled={isExportingPDF}
            className="font-mono text-xs tracking-wide border-amber-500/30 text-amber-400 hover:text-amber-300 hover:border-amber-400/50 no-print"
            data-testid="button-export-pdf-playbook"
          >
            {isExportingPDF ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 shrink-0 animate-spin" />
            ) : (
              <FileDown className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            )}
            {isExportingPDF ? "EXPORTING..." : "DOWNLOAD PDF"}
          </Button>
        </div>

        {onDelete && (
          <div className="mt-8 border border-red-500/20 rounded-lg bg-red-500/5 p-4" data-testid="section-danger-zone">
            <h3 className="text-sm font-bold text-red-400 mb-1 flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Workspace Settings
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              Manage Playbook: Generated on {new Date(playbook.createdAt).toLocaleDateString()} by AI Agent. Use this to clean up your dashboard history.
            </p>
            {!confirmDelete ? (
              <Button
                variant="outline"
                size="sm"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 gap-1.5 min-h-[44px]"
                onClick={() => setConfirmDelete(true)}
                data-testid="button-delete-playbook"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete this Playbook
              </Button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-red-400 italic">Are you sure? This cannot be undone.</span>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => onDelete(playbook.id)}
                  disabled={isDeleting}
                  data-testid="button-confirm-delete"
                >
                  {isDeleting ? "Deleting..." : "Confirm Delete"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  data-testid="button-cancel-delete"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="print-footer">
          Confidential Trading Logic — Generated by TraderNotes AI.
        </div>
      </div>
    </ScrollArea>
  );
});
