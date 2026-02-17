import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Eye, EyeOff, Zap } from "lucide-react";

type AuthMode = "login" | "signup";

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const authMutation = useMutation({
    mutationFn: async () => {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body: any = { email, password };
      if (mode === "signup") {
        body.firstName = firstName;
        body.lastName = lastName;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Authentication failed");
      }

      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      navigate("/");
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    authMutation.mutate();
  };

  const toggleMode = () => {
    setMode(mode === "login" ? "signup" : "login");
    setError("");
  };

  return (
    <div className="min-h-screen bg-[#0e1116] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <a href="/" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-amber-500 transition-colors mb-8 font-mono" data-testid="link-back-home">
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </a>

        <div className="rounded-xl border border-amber-500/20 bg-[#161b22] p-8 shadow-2xl shadow-amber-500/5">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-5 w-5 bg-amber-500 rounded-sm animate-pulse" />
            <span className="font-mono font-bold text-lg tracking-widest uppercase text-amber-500">
              TraderNotes AI
            </span>
          </div>

          <div className="flex items-center gap-2 mb-8">
            <Zap className="h-3 w-3 text-amber-400" />
            <p className="text-xs font-mono text-gray-400">
              {mode === "login" ? "Sign in to your workspace" : "Create your trading workspace"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === "signup" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-xs font-mono text-gray-400 uppercase tracking-wider">First Name</Label>
                  <Input
                    id="firstName"
                    type="text"
                    placeholder="John"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="bg-[#0e1116] border-gray-700 text-white placeholder-gray-600 focus:border-amber-500/50 focus:ring-amber-500/20 font-mono"
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-xs font-mono text-gray-400 uppercase tracking-wider">Last Name</Label>
                  <Input
                    id="lastName"
                    type="text"
                    placeholder="Doe"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="bg-[#0e1116] border-gray-700 text-white placeholder-gray-600 focus:border-amber-500/50 focus:ring-amber-500/20 font-mono"
                    data-testid="input-last-name"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-mono text-gray-400 uppercase tracking-wider">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="trader@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-[#0e1116] border-gray-700 text-white placeholder-gray-600 focus:border-amber-500/50 focus:ring-amber-500/20 font-mono"
                data-testid="input-email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-mono text-gray-400 uppercase tracking-wider">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={mode === "signup" ? "Min. 6 characters" : "Enter your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-[#0e1116] border-gray-700 text-white placeholder-gray-600 focus:border-amber-500/50 focus:ring-amber-500/20 font-mono pr-10"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-red-400 text-xs font-mono bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2" data-testid="text-auth-error">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-600 text-black font-mono font-bold text-sm"
              disabled={authMutation.isPending}
              data-testid="button-auth-submit"
            >
              {authMutation.isPending
                ? "Processing..."
                : mode === "login"
                ? "Sign In"
                : "Create Account"}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={toggleMode}
              className="text-xs font-mono text-gray-400 hover:text-amber-500 transition-colors"
              data-testid="button-toggle-mode"
            >
              {mode === "login"
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
