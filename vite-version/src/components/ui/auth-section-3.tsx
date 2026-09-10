"use client";

import { useState } from "react";
import { FlutedGlass } from "@paper-design/shaders-react";
import { motion } from "motion/react";
import { toast } from "sonner";

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

const termsText = (
  <>
    By authenticating with Discord, you agree to the InterENL{" "}
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

export default function AuthSectionThree({
  mode: initialMode = "signup",
  onModeChange,
}: AuthSectionThreeProps) {
  const [mode, setMode] = useState<"signup" | "signin">(initialMode);
  const [isConnecting, setIsConnecting] = useState(false);

  const switchMode = (newMode: "signup" | "signin") => {
    setMode(newMode);
    onModeChange?.(newMode);
  };

  const handleDiscordAuth = () => {
    setIsConnecting(true);
    const clientId =
      (typeof import.meta !== "undefined" &&
        (import.meta as unknown as { env?: Record<string, string> }).env
          ?.VITE_DISCORD_CLIENT_ID) ||
      (typeof process !== "undefined" &&
        process.env?.NEXT_PUBLIC_DISCORD_CLIENT_ID);

    const redirectUri =
      (typeof import.meta !== "undefined" &&
        (import.meta as unknown as { env?: Record<string, string> }).env
          ?.VITE_DISCORD_REDIRECT_URI) ||
      (typeof process !== "undefined" &&
        process.env?.NEXT_PUBLIC_DISCORD_REDIRECT_URI) ||
      (typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback`
        : "/auth/callback");

    const scopes =
      (typeof import.meta !== "undefined" &&
        (import.meta as unknown as { env?: Record<string, string> }).env
          ?.VITE_DISCORD_SCOPES) || "identify email";

    if (
      !clientId ||
      clientId === "your_discord_client_id_here" ||
      clientId === "123456789012345678"
    ) {
      setIsConnecting(false);
      toast.error("Discord OAuth2 Not Configured", {
        description:
          "Please configure VITE_DISCORD_CLIENT_ID in your .env file on the server and rebuild.",
      });
      return;
    }

    // Direct redirect to Discord's official OAuth2 authorization portal
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=token&scope=${encodeURIComponent(scopes)}`;

    window.location.href = authUrl;
  };

  // Resolve base public asset path
  const basePath =
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string> }).env
        ?.BASE_URL) || "/";
  const lightDashboardImg = `${basePath.endsWith("/") ? basePath : basePath + "/"}dashboard-light.png`;
  const darkDashboardImg = `${basePath.endsWith("/") ? basePath : basePath + "/"}dashboard-dark.png`;

  return (
    <section className="min-h-screen bg-background p-3 text-foreground antialiased [font-synthesis:none] transition-colors duration-200">
      <div className="grid min-h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        {/* Left Side - Discord-Only Auth Box */}
        <div className="flex min-h-[760px] items-center justify-center rounded-2xl border border-border bg-card px-6 py-12 shadow-sm dark:bg-[#0a0a0c] lg:min-h-0 lg:px-14 lg:py-20 xl:px-20">
          <div className="mx-auto w-full max-w-[440px]">
            {/* Logo and Brand Header */}
            <div>
              <div className="flex items-center gap-2.5 mb-6">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm">
                  ID
                </div>
                <div>
                  <span className="font-bold tracking-tight text-lg text-foreground block leading-tight">
                    InterDash
                  </span>
                  <span className="text-[11px] text-muted-foreground block leading-none">
                    InterENL Cloud Infrastructure
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
                  ? "Authorize with your Discord account to instantly provision up to 5 free high-performance Linux cloud VPS instances."
                  : "Sign in with Discord to manage your Linux cloud instances, real-time telemetry, and SSH keys."}
              </p>
            </div>

            {/* Exclusive Discord Authentication Action (21st.dev Style) */}
            <div className="mt-8 space-y-4">
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

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-muted-foreground space-y-2">
                <div className="flex items-center gap-2 font-medium text-white">
                  <ShieldIcon className="size-4 shrink-0" />
                  <span>Single Sign-On Security</span>
                </div>
                <p className="leading-relaxed">
                  Discord is the exclusive authentication provider for InterDash. We use Discord OAuth2 to protect against unauthorized instance abuse without requiring credit cards or passwords.
                </p>
              </div>
            </div>

            {/* Feature Checklist - 21st.dev Pure White Icons */}
            <div className="mt-6 space-y-2.5 pt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-white/10 shrink-0">
                  <CheckIcon className="size-2.5" />
                </span>
                <span>1 Dedicated AMD EPYC™ vCPU per instance</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-white/10 shrink-0">
                  <CheckIcon className="size-2.5" />
                </span>
                <span>DDR5 4800MHz RAM & PCIe 4.0 NVMe SSD storage</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex size-4 items-center justify-center rounded-full bg-white/10 shrink-0">
                  <CheckIcon className="size-2.5" />
                </span>
                <span>Zero credit card required — $0/month forever</span>
              </div>
            </div>

            {/* Terms and Policies */}
            <div className="mt-8 pt-4 border-t border-border text-center text-xs text-muted-foreground leading-relaxed">
              {termsText}
            </div>

            {/* Mode Switcher */}
            <div className="mt-6 text-center text-xs text-muted-foreground">
              {mode === "signup" ? (
                <span>
                  Already an active VPS user?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="font-semibold text-foreground underline underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                  >
                    Sign in with Discord
                  </button>
                </span>
              ) : (
                <span>
                  New to InterDash Cloud?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className="font-semibold text-foreground underline underline-offset-2 hover:text-primary transition-colors cursor-pointer"
                  >
                    Create free account with Discord
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
              distortion={0.5}
              shift={0}
              blur={0}
              edges={0.25}
              stretch={0}
              scale={1.11}
              fit="cover"
              highlights={0.1}
              shadows={0.2}
              grainMixer={0.1}
              grainOverlay={0.1}
              colorBack="#00000000"
              colorHighlight="#FFFFFF"
              colorShadow="#000000"
              className="w-full h-full bg-transparent"
            />
          </div>

          <div className="relative z-10 h-full w-full flex flex-col justify-between">
            <div className="max-w-[480px] lg:pt-6">
              <motion.div
                initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-10%" }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-4"
              >
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&h=160&q=80"
                  alt="Charlotte Vance - Lead Cloud Architect"
                  className="size-11 shrink-0 rounded-full border border-white/20 object-cover shadow-lg"
                />
                <div>
                  <div className="font-semibold leading-tight text-white flex items-center gap-1.5">
                    Charlotte Vance
                    <span className="size-1.5 rounded-full bg-white/80" />
                  </div>
                  <div className="mt-0.5 text-xs text-white/60">
                    Lead Cloud Infrastructure Architect
                  </div>
                </div>
              </motion.div>

              <motion.blockquote
                initial={{ opacity: 0, y: 18, filter: "blur(8px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-10%" }}
                transition={{
                  duration: 0.8,
                  delay: 0.12,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="mt-7 text-2xl font-light leading-tight tracking-[-0.035em] text-white/95 sm:text-3xl lg:text-[32px]"
              >
                “With InterDash and instant Discord authentication, provisioning
                our distributed NVMe Linux instances took under thirty seconds.”
              </motion.blockquote>

              <div className="mt-4 flex items-center gap-4 text-xs text-white/70">
                <span className="flex items-center gap-1.5 text-white">
                  <ZapIcon className="size-3.5 shrink-0" />
                  <strong>1 vCPU</strong> Dedicated
                </span>
                <span className="text-white/30">•</span>
                <span className="flex items-center gap-1.5 text-white">
                  <ServerIcon className="size-3.5 shrink-0" />
                  <strong>DDR5</strong> 4800MHz
                </span>
                <span className="text-white/30">•</span>
                <span className="flex items-center gap-1.5 text-white">
                  <GlobeIcon className="size-3.5 shrink-0" />
                  <strong>1 Gbps</strong> Port
                </span>
              </div>
            </div>

            {/* Dashboard Mockup using the landing page image */}
            <div className="mt-8 w-full max-w-[720px] sm:max-w-[780px] lg:max-w-none overflow-hidden rounded-2xl border border-white/15 bg-black/85 p-2 shadow-[0_35px_95px_rgba(0,0,0,0.75)] backdrop-blur-xl lg:absolute lg:left-[4%] lg:-bottom-20 lg:mt-0 lg:w-[116%] xl:left-[5%] xl:-bottom-26 xl:w-[120%] 2xl:w-[124%] lg:origin-bottom-left lg:-rotate-1">
              <motion.div
                initial={{ opacity: 0, y: 60, filter: "blur(8px)" }}
                whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-10%" }}
                transition={{
                  duration: 0.9,
                  delay: 0.2,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="overflow-hidden rounded-xl border border-white/10 bg-black"
              >
                {/* 21st.dev style monochrome window header */}
                <div className="flex items-center gap-1.5 border-b border-white/10 bg-zinc-950/90 px-4 py-2.5 select-none">
                  <div className="size-2 rounded-full bg-white/35" />
                  <div className="size-2 rounded-full bg-white/25" />
                  <div className="size-2 rounded-full bg-white/15" />
                  <span className="ml-3 text-[10px] font-mono tracking-wider text-white/60 flex items-center gap-1.5 bg-white/5 px-2.5 py-0.5 rounded-full border border-white/10">
                    <span className="size-1 rounded-full bg-white/80" /> interdash.enl/dashboard
                  </span>
                </div>

                {/* Light mode dashboard preview */}
                <img
                  src={lightDashboardImg}
                  alt="InterDash Cloud VPS Dashboard Preview - Light Mode"
                  className="h-auto max-h-[400px] lg:max-h-[460px] w-full object-cover object-top block dark:hidden"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/dashboard-light.png";
                  }}
                />

                {/* Dark mode dashboard preview */}
                <img
                  src={darkDashboardImg}
                  alt="InterDash Cloud VPS Dashboard Preview - Dark Mode"
                  className="h-auto max-h-[400px] lg:max-h-[460px] w-full object-cover object-top hidden dark:block"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/dashboard-dark.png";
                  }}
                />
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * 21st.dev pure white SVG icons
 */
function DiscordIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 127.14 96.36"
      fill="#FFFFFF"
      aria-hidden="true"
      className={className}
    >
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  );
}

function ShieldIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
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

function CheckIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ZapIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}

function ServerIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </svg>
  );
}

function GlobeIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" x2="22" y1="12" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
