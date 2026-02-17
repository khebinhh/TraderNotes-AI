import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/LandingPage";
import AuthPage from "@/pages/AuthPage";
import { DashboardLayout } from "./components/dashboard/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";

function AuthRouter() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-full bg-[#0e1116] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="h-6 w-6 bg-amber-500 rounded-sm animate-pulse mx-auto" />
          <p className="text-sm font-mono text-gray-400 animate-pulse">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/auth" component={AuthPage} />
        <Route component={LandingPage} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={DashboardLayout} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthRouter />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
