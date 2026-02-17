import { BarChart3, Brain, LineChart, Shield, TrendingUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0e1116] text-white">
      <nav className="fixed top-0 w-full z-50 border-b border-amber-500/10 bg-[#0e1116]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 bg-amber-500 rounded-sm animate-pulse" />
            <span className="font-mono font-bold text-lg tracking-widest uppercase text-amber-500">
              TraderNotes AI
            </span>
          </div>
          <a href="/auth" data-testid="button-login-nav">
            <Button variant="outline" className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:text-amber-400 font-mono text-sm">
              Sign In
            </Button>
          </a>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/20 bg-amber-500/5 text-amber-400 text-xs font-mono">
              <Zap className="h-3 w-3" />
              AI-Powered Trading Intelligence
            </div>
            <h1 className="text-5xl lg:text-6xl font-serif font-bold leading-tight">
              Your Trading Notes,{" "}
              <span className="text-amber-500">Supercharged</span>{" "}
              with AI
            </h1>
            <p className="text-lg text-gray-400 max-w-lg leading-relaxed">
              Merge your technical analysis notes with real-time charts and an AI mentor that knows your levels, 
              game plans, and trading style. Every ticker gets its own workspace.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a href="/auth" data-testid="button-get-started">
                <Button size="lg" className="bg-amber-500 hover:bg-amber-600 text-black font-mono font-bold text-sm px-8 w-full sm:w-auto">
                  Get Started Free
                </Button>
              </a>
            </div>
            <div className="flex items-center gap-6 text-xs text-gray-500 font-mono">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-green-500" />
                Free forever plan
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                No credit card required
              </div>
            </div>
          </div>

          <div className="relative hidden lg:block">
            <div className="rounded-xl border border-amber-500/20 bg-[#161b22] p-6 shadow-2xl shadow-amber-500/5 transition-transform duration-500 hover:scale-[1.02]">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
                <span className="ml-2 text-xs font-mono text-gray-500">TraderNotes AI — BTCUSD Workspace</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs font-mono">
                <div className="col-span-1 bg-[#0e1116] rounded-lg p-3 border border-amber-500/10">
                  <div className="text-amber-500/70 mb-2 text-[10px] uppercase tracking-widest">Notes</div>
                  <div className="space-y-2">
                    <div className="bg-amber-500/5 border border-amber-500/10 rounded px-2 py-1.5 text-gray-300">BTC Bullish Setup</div>
                    <div className="bg-[#161b22] border border-gray-800 rounded px-2 py-1.5 text-gray-500">BTC Reversal Play</div>
                  </div>
                </div>
                <div className="col-span-1 bg-[#0e1116] rounded-lg p-3 border border-amber-500/10">
                  <div className="text-amber-500/70 mb-2 text-[10px] uppercase tracking-widest">AI Mentor</div>
                  <div className="space-y-2">
                    <div className="bg-amber-500/10 rounded px-2 py-1.5 text-amber-300 text-[11px]">Support: 68,660</div>
                    <div className="bg-red-500/10 rounded px-2 py-1.5 text-red-300 text-[11px]">Resistance: 69,200</div>
                    <div className="bg-[#161b22] border border-gray-800 rounded px-2 py-1.5 text-gray-400 text-[11px]">Hold above pivot...</div>
                  </div>
                </div>
                <div className="col-span-1 bg-[#0e1116] rounded-lg p-3 border border-amber-500/10">
                  <div className="text-amber-500/70 mb-2 text-[10px] uppercase tracking-widest">Chart</div>
                  <div className="h-20 flex items-end gap-0.5 px-1">
                    {[40, 55, 45, 60, 50, 70, 65, 75, 80, 72, 85, 78, 90, 88, 95].map((h, i) => (
                      <div key={i} className="flex-1 bg-amber-500/40 rounded-t" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t border-gray-800/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-serif font-bold mb-4">Built for Serious Traders</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Everything you need to organize your trading analysis, track key levels, and stay disciplined.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="group p-8 rounded-xl border border-gray-800 bg-[#161b22]/50 hover:bg-[#161b22] hover:border-amber-500/20 transition-all duration-300">
              <div className="h-12 w-12 rounded-lg bg-amber-500/10 flex items-center justify-center mb-6 group-hover:bg-amber-500/20 transition-colors">
                <Brain className="h-6 w-6 text-amber-500" />
              </div>
              <h3 className="text-lg font-bold mb-3">AI Trading Mentor</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Your personal AI that knows your notes, levels, and game plans. Ask it anything about your trading setup.
              </p>
            </div>

            <div className="group p-8 rounded-xl border border-gray-800 bg-[#161b22]/50 hover:bg-[#161b22] hover:border-amber-500/20 transition-all duration-300">
              <div className="h-12 w-12 rounded-lg bg-amber-500/10 flex items-center justify-center mb-6 group-hover:bg-amber-500/20 transition-colors">
                <LineChart className="h-6 w-6 text-amber-500" />
              </div>
              <h3 className="text-lg font-bold mb-3">Live TradingView Charts</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Real-time charts that sync with your active ticker. See your levels right alongside the price action.
              </p>
            </div>

            <div className="group p-8 rounded-xl border border-gray-800 bg-[#161b22]/50 hover:bg-[#161b22] hover:border-amber-500/20 transition-all duration-300">
              <div className="h-12 w-12 rounded-lg bg-amber-500/10 flex items-center justify-center mb-6 group-hover:bg-amber-500/20 transition-colors">
                <BarChart3 className="h-6 w-6 text-amber-500" />
              </div>
              <h3 className="text-lg font-bold mb-3">Ticker Workspaces</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Each stock gets its own workspace with notes, checklists, events, and chat. Stay organized across all your setups.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-800/50 py-8 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
            <div className="h-3 w-3 bg-amber-500/50 rounded-sm" />
            TraderNotes AI
          </div>
          <p className="text-xs text-gray-600 font-mono">&copy; {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
