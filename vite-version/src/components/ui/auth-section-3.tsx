import { useState, useEffect, useCallback } from "react";
import { FlutedGlass } from "@paper-design/shaders-react";
import { useSettings } from "@/contexts/settings-context";
import { Logo } from "@/components/logo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, Lock, User } from "lucide-react";

interface AuthProvidersStatus {
  discord: {
    enabled: boolean;
    isConfigured: boolean;
  };
  email: {
    enabled: boolean;
    allowRegistration: boolean;
    minPasswordLength: number;
  };
  activeProviders: string[];
}

interface AuthSectionThreeProps {
  /**
   * Auth view mode: "signup" or "signin"
   * @default "signup"
   */
  mode?: "signup" | "signin";
  /**
   * Callback fired when user toggles between sign up and sign in
   */
  onModeChange?: (mode: "signup" | "signin") => void;
}

function TermsNotice({ brandName }: { brandName?: string }) {
  return (
    <>
      By authenticating, you agree to the {brandName || "InterDash"}{" "}
      <a
        href="#"
        className="font-medium text-foreground underline underline-offset-2 hover:text-white transition-colors"
      >
        Terms of Service
      </a>{" "}
      and{" "}
      <a
        href="#"
        className="font-medium text-foreground underline underline-offset-2 hover:text-white transition-colors"
      >
        Privacy Policy
      </a>
      .
    </>
  );
}

export default function AuthSectionThree({
  mode: initialMode = "signup",
  onModeChange,
}: AuthSectionThreeProps) {
  const { settings } = useSettings();
  const [mode, setMode] = useState<"signup" | "signin">(initialMode);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Provider configuration status
  const [providers, setProviders] = useState<AuthProvidersStatus | null>(null);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);

  // Email form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/providers");
      if (res.ok) {
        const data = await res.json();
        setProviders(data);
      }
    } catch {
      // Fallback: assume default Discord auth
      setProviders({
        discord: { enabled: true, isConfigured: true },
        email: { enabled: false, allowRegistration: false, minPasswordLength: 8 },
        activeProviders: ["discord"],
      });
    } finally {
      setIsLoadingProviders(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (!err) return;

    switch (err) {
      case "discord_disabled":
        setErrorMessage("Discord authentication is currently disabled on this panel.");
        break;
      case "discord_not_configured":
        setErrorMessage(
          "Discord OAuth is not yet configured on this server. Please add your numeric DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in Admin Settings or the .env file."
        );
        break;
      case "discord_denied":
        setErrorMessage("Discord authorization was cancelled or denied.");
        break;
      case "invalid_state":
        setErrorMessage("OAuth session state expired or mismatched. Please try again.");
        break;
      case "missing_code":
        setErrorMessage("Discord did not return an authorization code.");
        break;
      case "account_suspended":
        setErrorMessage("Your account is currently suspended.");
        break;
      default:
        setErrorMessage(`Authentication error: ${err}`);
        break;
    }
  }, []);

  const switchMode = (newMode: "signup" | "signin") => {
    setErrorMessage(null);
    setMode(newMode);
    onModeChange?.(newMode);
  };

  const handleDiscordAuth = () => {
    setIsConnecting(true);
    setErrorMessage(null);
    // Redirect to server-side OAuth flow
    window.location.href = "/api/auth/discord";
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const minLen = providers?.email.minPasswordLength || 8;
    if (password.length < minLen) {
      setErrorMessage(`Password must be at least ${minLen} characters long.`);
      return;
    }

    if (mode === "signup" && password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsEmailSubmitting(true);

    try {
      const csrfRes = await fetch("/api/auth/csrf");
      let csrfToken = "";
      if (csrfRes.ok) {
        const c = await csrfRes.json();
        csrfToken = c.token;
      }

      const endpoint = mode === "signup" ? "/api/auth/email/register" : "/api/auth/email/login";
      const payload: Record<string, string> = {
        email: email.trim().toLowerCase(),
        password,
      };
      if (mode === "signup" && username.trim()) {
        payload.username = username.trim();
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed.");
      }

      // Success! Session cookie is set, redirect to dashboard
      window.location.href = "/instances";
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setIsEmailSubmitting(false);
    }
  };

  const discordEnabled = providers?.discord.enabled ?? true;
  const emailEnabled = providers?.email.enabled ?? false;
  const emailCanRegister = providers?.email.allowRegistration ?? false;

  return (
    <section className="min-h-screen bg-background p-3 text-foreground antialiased [font-synthesis:none] transition-colors duration-200">
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        {/* Left Side - Auth Box */}
        <div className="flex min-h-[760px] items-center justify-center rounded-2xl border border-border bg-card px-6 py-12 shadow-sm dark:bg-[#0a0a0c] lg:min-h-0 lg:px-14 lg:py-20 xl:px-20">
          <div className="mx-auto w-full max-w-[440px]">
            {/* Logo and Brand Header */}
            <div>
              <div className="flex items-center gap-2.5 mb-6">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm overflow-hidden">
                  <Logo size={24} className="text-current" />
                </div>
                <div>
                  <span className="font-bold tracking-tight text-lg text-foreground block leading-tight">
                    {settings.brand_name || "InterDash"}
                  </span>
                  <span className="text-[11px] text-muted-foreground block leading-none">
                    {settings.panel_title || "Cloud VPS Infrastructure"}
                  </span>
                </div>
                <span className="ml-auto text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-white font-medium flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-white animate-pulse" />
                  Free Tier Active
                </span>
              </div>

              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl text-foreground">
                {mode === "signup" ? "Create your account" : "Welcome back"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {mode === "signup"
                  ? "Sign up to instantly provision high-performance Linux cloud VPS instances."
                  : "Sign in to manage your Linux cloud instances, real-time telemetry, and SSH keys."}
              </p>
            </div>

            {/* Error Message Alert */}
            {errorMessage && (
              <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-200 flex items-start gap-3 shadow-inner">
                <AlertCircleIcon className="size-4.5 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold text-red-100 block">Notice</span>
                  <p className="leading-relaxed opacity-90">{errorMessage}</p>
                </div>
              </div>
            )}

            {/* Main Auth Container */}
            <div className="mt-8 space-y-4">
              {isLoadingProviders ? (
                <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-5 animate-spin text-primary" />
                  Loading authentication options...
                </div>
              ) : !discordEnabled && !emailEnabled ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
                  <p className="font-semibold">Authentication Unavailable</p>
                  <p className="mt-1 opacity-90">
                    No authentication methods are currently enabled on this server. Please contact an administrator.
                  </p>
                </div>
              ) : (
                <>
                  {/* Discord OAuth Button */}
                  {discordEnabled && (
                    <button
                      type="button"
                      onClick={handleDiscordAuth}
                      disabled={isConnecting}
                      className="group relative flex h-13 w-full min-w-0 items-center justify-center gap-3 rounded-xl border border-white/20 bg-zinc-950 text-white hover:bg-zinc-900 dark:border-white/20 dark:bg-white/10 dark:hover:bg-white/15 px-6 text-sm font-semibold shadow-lg backdrop-blur-md transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-75"
                      aria-label={
                        mode === "signup"
                          ? "Sign up with Discord"
                          : "Sign in with Discord"
                      }
                    >
                      <DiscordIcon className="size-5 shrink-0 transition-transform group-hover:scale-110" />
                      <span className="whitespace-nowrap tracking-wide text-white font-medium">
                        {isConnecting
                          ? "Connecting..."
                          : mode === "signup"
                          ? "Sign up with Discord"
                          : "Sign in with Discord"}
                      </span>
                    </button>
                  )}

                  {/* Divider when both are enabled */}
                  {discordEnabled && emailEnabled && (
                    <div className="relative flex items-center justify-center my-4">
                      <div className="w-full border-t border-border" />
                      <span className="bg-card dark:bg-[#0a0a0c] px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider relative">
                        or with email
                      </span>
                    </div>
                  )}

                  {/* Email & Password Form */}
                  {emailEnabled && (
                    <>
                      {mode === "signup" && !emailCanRegister ? (
                        <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground text-center">
                          Public email registration is currently disabled. Please use Discord to register or sign in with an existing account.
                        </div>
                      ) : (
                        <form onSubmit={handleEmailAuth} className="space-y-3.5">
                          {mode === "signup" && (
                            <div className="space-y-1.5">
                              <Label className="text-xs">Username (optional)</Label>
                              <div className="relative">
                                <User className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                  type="text"
                                  placeholder="johndoe"
                                  value={username}
                                  onChange={(e) => setUsername(e.target.value)}
                                  className="pl-9 text-xs h-10 bg-background/50"
                                />
                              </div>
                            </div>
                          )}

                          <div className="space-y-1.5">
                            <Label className="text-xs">Email Address</Label>
                            <div className="relative">
                              <Mail className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                type="email"
                                required
                                placeholder="name@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="pl-9 text-xs h-10 bg-background/50"
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs">Password</Label>
                            <div className="relative">
                              <Lock className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                type="password"
                                required
                                minLength={providers?.email.minPasswordLength || 8}
                                placeholder="••••••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="pl-9 text-xs h-10 bg-background/50"
                              />
                            </div>
                          </div>

                          {mode === "signup" && (
                            <div className="space-y-1.5">
                              <Label className="text-xs">Confirm Password</Label>
                              <div className="relative">
                                <Lock className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                  type="password"
                                  required
                                  minLength={providers?.email.minPasswordLength || 8}
                                  placeholder="••••••••••••"
                                  value={confirmPassword}
                                  onChange={(e) => setConfirmPassword(e.target.value)}
                                  className="pl-9 text-xs h-10 bg-background/50"
                                />
                              </div>
                            </div>
                          )}

                          <button
                            type="submit"
                            disabled={isEmailSubmitting}
                            className="w-full flex h-10 items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-medium text-xs shadow-sm hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-75 mt-2"
                          >
                            {isEmailSubmitting && <Loader2 className="size-3.5 animate-spin" />}
                            {mode === "signup" ? "Create Account with Email" : "Sign In with Email"}
                          </button>
                        </form>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Security Guarantee Notice */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-muted-foreground space-y-2">
                <div className="flex items-center gap-2 font-medium text-white">
                  <ShieldIcon className="size-4 shrink-0" />
                  <span>Encrypted & Verified Authentication</span>
                </div>
                <p className="leading-relaxed">
                  InterDash uses secure HTTP-only cookies, scrypt password hashing, and AES-256-GCM encrypted tokens to safeguard all cloud instances.
                </p>
              </div>
            </div>

            {/* Feature Checklist */}
            <div className="mt-6 space-y-2.5 pt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-white/10 shrink-0">
                  <CheckIcon className="size-2.5" />
                </span>
                <span>Dedicated high-performance AMD EPYC™ vCPU compute</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-white/10 shrink-0">
                  <CheckIcon className="size-2.5" />
                </span>
                <span>DDR5 RAM & Enterprise NVMe SSD storage</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-white/10 shrink-0">
                  <CheckIcon className="size-2.5" />
                </span>
                <span>Instant provisioning & integrated Proxmox VE hypervisor</span>
              </div>
            </div>

            {/* Terms and Policies */}
            <div className="mt-8 pt-4 border-t border-border text-center text-xs text-muted-foreground leading-relaxed">
              <TermsNotice brandName={settings.brand_name} />
            </div>

            {/* Mode Switcher */}
            <div className="mt-6 text-center text-xs text-muted-foreground">
              {mode === "signup" ? (
                <span>
                  Already an active user?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="font-semibold text-foreground underline underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                  >
                    Sign in to your account
                  </button>
                </span>
              ) : (
                <span>
                  New to {settings.brand_name || "InterDash"} Cloud?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className="font-semibold text-foreground underline underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                  >
                    Create a free account
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right Side - Marketing Testimonial and Landing Page Dashboard Mockup */}
        <div className="relative flex min-h-[720px] flex-col overflow-hidden rounded-2xl bg-gradient-to-b from-black via-zinc-950 to-zinc-900 p-8 text-white dark:from-[#050505] dark:via-[#09090c] dark:to-[#050505] sm:p-12 lg:min-h-0 lg:p-16 border border-border">
          {/* Background Shader */}
          <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
            <FlutedGlass
              size={0.89}
              shape="lines"
              angle={0}
              distortionShape="prism"
              distortion={0.16}
              scale={1.05}
            />
          </div>

          <div className="relative z-10 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-4">
                <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
                Cluster Operational
              </div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl text-white">
                Ultra-low latency cloud virtual private servers.
              </h2>
              <p className="mt-2 text-sm text-zinc-400 max-w-md">
                Deploy developer-ready Linux environments in seconds with complete root access and real-time Proxmox hypervisor telemetry.
              </p>
            </div>

            {/* Testimonial / Telemetry Card */}
            <div className="my-8 rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3 text-xs text-zinc-400">
                <span className="font-mono">PROXMOX VE CLUSTER</span>
                <span className="text-emerald-400 font-semibold">99.99% UPTIME</span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed italic">
                &ldquo;InterDash delivers instant provisioning and enterprise hypervisor controls with seamless authentication and rock-solid reliability.&rdquo;
              </p>
            </div>

            <div className="text-xs text-zinc-500">
              © {new Date().getFullYear()} {settings.brand_name || "InterDash"}. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DiscordIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function ShieldIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function CheckIcon({ className = "size-2.5" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function AlertCircleIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}
