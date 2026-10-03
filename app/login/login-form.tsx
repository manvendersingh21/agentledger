"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ArrowButton } from "@/components/brand/arrow-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEMO_EMAIL = "demo@agentledger.dev";
const DEMO_PASSWORD = "agentledger-demo";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  async function completeAuth() {
    router.replace(next ?? "/dashboard");
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          setError(signInError.message);
          return;
        }
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
      }
      await completeAuth();
    } finally {
      setLoading(false);
    }
  }

  async function handleDemo() {
    setError(null);
    setLoading(true);
    const supabase = createClient();
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      await completeAuth();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="space-y-2">
        <Label htmlFor="email" className="text-ink">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="h-12"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="text-ink">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12"
        />
      </div>

      {error ? (
        <p role="alert" className="rounded border border-blocked/30 bg-blocked-bg px-3 py-2 text-sm text-blocked">
          {error}
        </p>
      ) : null}

      <ArrowButton type="submit" disabled={loading} className="w-full [&>span:first-child]:flex-1">
        {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </ArrowButton>

      {demoMode ? (
        <ArrowButton
          variant="secondary"
          disabled={loading}
          onClick={handleDemo}
          className="w-full [&>span:first-child]:flex-1"
        >
          Use demo account
        </ArrowButton>
      ) : null}

      <button
        type="button"
        className="text-sm text-ink-2 underline-offset-4 transition-colors hover:text-accent hover:underline disabled:opacity-50"
        disabled={loading}
        onClick={() => {
          setMode((m) => (m === "signin" ? "signup" : "signin"));
          setError(null);
        }}
      >
        {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
