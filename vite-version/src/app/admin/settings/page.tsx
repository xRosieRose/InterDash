import * as React from "react"
import { useSearchParams } from "react-router-dom"
import {
  Save,
  Loader2,
  Globe,
  Shield,
  Upload,
  Image as ImageIcon,
  KeyRound,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Settings2,
  Key,
  Terminal,
  ShieldAlert,
} from "lucide-react"
import { ApiKeysManager } from "@/components/admin/api-keys-manager"
import { StartupScriptManager } from "@/components/admin/startup-script-manager"
import { AntiMinerManager } from "@/components/admin/anti-miner-manager"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"
import { useSettings } from "@/contexts/settings-context"

interface AuthSettingsResponse {
  discord: {
    enabled: boolean
    clientId: string
    hasClientSecret: boolean
    clientSecretMasked: string
    redirectUri: string
    effectiveRedirectUri: string
    source: "database" | "environment" | "mixed"
    isConfigured: boolean
  }
  email: {
    enabled: boolean
    allowRegistration: boolean
    minPasswordLength: number
  }
  summary: {
    activeProviders: string[]
    canDisableDiscord: boolean
    canDisableEmail: boolean
  }
}

function normalizeImageUrl(url: string): string {
  if (!url) return url
  const trimmed = url.trim()
  const imgurPageMatch = trimmed.match(/^https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)$/)
  if (imgurPageMatch) {
    return `https://i.imgur.com/${imgurPageMatch[1]}.png`
  }
  const imgurDirectNoExt = trimmed.match(/^https?:\/\/i\.imgur\.com\/([a-zA-Z0-9]+)$/)
  if (imgurDirectNoExt) {
    return `https://i.imgur.com/${imgurDirectNoExt[1]}.png`
  }
  return trimmed
}

function ImagePreview({
  src,
  fallbackText,
  isFavicon = false,
}: {
  src: string
  fallbackText: string
  isFavicon?: boolean
}) {
  const [triedProxy, setTriedProxy] = React.useState(false)
  const [hasError, setHasError] = React.useState(false)

  React.useEffect(() => {
    setTriedProxy(false)
    setHasError(false)
  }, [src])

  if (!src) {
    return <span className="text-xs text-muted-foreground/50">{fallbackText}</span>
  }

  const effectiveSrc =
    triedProxy && !src.startsWith("data:")
      ? `/api/settings/proxy-image?url=${encodeURIComponent(src)}`
      : src

  if (hasError) {
    return (
      <div
        className="flex flex-col items-center justify-center text-amber-500 p-1"
        title="Image failed to load directly. Try uploading directly or check the URL."
      >
        {isFavicon ? <Globe className="size-4" /> : <ImageIcon className="size-4" />}
      </div>
    )
  }

  return (
    <img
      src={effectiveSrc}
      alt="Preview"
      referrerPolicy="no-referrer"
      onError={() => {
        if (!triedProxy && !src.startsWith("data:")) {
          setTriedProxy(true)
        } else {
          setHasError(true)
        }
      }}
      className={isFavicon ? "size-6 object-contain" : "size-full object-contain"}
    />
  )
}

export default function AdminSettingsPage() {
  const { refreshSettings } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get("tab")
  const activeTab = tabParam === "anti-miner" ? "anti-miner" : tabParam === "startup-script" ? "startup-script" : tabParam === "api-keys" ? "api-keys" : tabParam === "authentication" ? "authentication" : "general"

  // General tab state
  const [brandName, setBrandName] = React.useState("InterDash")
  const [panelTitle, setPanelTitle] = React.useState("InterDash — Cloud VPS Control Panel")
  const [logoUrl, setLogoUrl] = React.useState("")
  const [faviconUrl, setFaviconUrl] = React.useState("")
  const [supportUrl, setSupportUrl] = React.useState("https://discord.gg/interenl")
  const [websiteUrl, setWebsiteUrl] = React.useState("https://interenl.com")
  const [discordUrl, setDiscordUrl] = React.useState("https://discord.gg/interenl")
  const [contactEmail, setContactEmail] = React.useState("support@interenl.com")

  const logoInputRef = React.useRef<HTMLInputElement | null>(null)
  const faviconInputRef = React.useRef<HTMLInputElement | null>(null)

  const [isLoadingGeneral, setIsLoadingGeneral] = React.useState(true)
  const [isSavingGeneral, setIsSavingGeneral] = React.useState(false)

  // Authentication tab state
  const [authData, setAuthData] = React.useState<AuthSettingsResponse | null>(null)
  const [isLoadingAuth, setIsLoadingAuth] = React.useState(true)
  const [isSavingAuth, setIsSavingAuth] = React.useState(false)

  const [discordEnabled, setDiscordEnabled] = React.useState(true)
  const [discordClientId, setDiscordClientId] = React.useState("")
  const [discordClientSecret, setDiscordClientSecret] = React.useState("")
  const [discordRedirectUri, setDiscordRedirectUri] = React.useState("")

  const [emailEnabled, setEmailEnabled] = React.useState(false)
  const [emailAllowReg, setEmailAllowReg] = React.useState(true)
  const [emailMinPassLength, setEmailMinPassLength] = React.useState(8)

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val }, { replace: true })
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file.")
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB.")
      return
    }
    const reader = new FileReader()
    reader.onload = (evt) => {
      const res = evt.target?.result as string
      if (res) {
        setLogoUrl(res)
        toast.success("Logo loaded!")
      }
    }
    reader.readAsDataURL(file)
  }

  const handleFaviconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid icon or image file.")
      return
    }
    if (file.size > 1 * 1024 * 1024) {
      toast.error("Favicon must be under 1 MB.")
      return
    }
    const reader = new FileReader()
    reader.onload = (evt) => {
      const res = evt.target?.result as string
      if (res) {
        setFaviconUrl(res)
        toast.success("Favicon loaded!")
      }
    }
    reader.readAsDataURL(file)
  }

  const fetchGeneralSettings = React.useCallback(async () => {
    try {
      const res = await fetch("/api/settings")
      if (res.ok) {
        const data = await res.json()
        const s = data.settings || {}
        if (s.brand_name) setBrandName(s.brand_name)
        if (s.panel_title) setPanelTitle(s.panel_title)
        if (s.logo_url) setLogoUrl(s.logo_url)
        if (s.favicon_url) setFaviconUrl(s.favicon_url)
        if (s.support_url) setSupportUrl(s.support_url)
        if (s.website_url) setWebsiteUrl(s.website_url)
        if (s.discord_url) setDiscordUrl(s.discord_url)
        if (s.contact_email) setContactEmail(s.contact_email)
      }
    } catch {
      toast.error("Failed to load current panel settings.")
    } finally {
      setIsLoadingGeneral(false)
    }
  }, [])

  const fetchAuthSettings = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings/authentication")
      if (res.ok) {
        const data: AuthSettingsResponse = await res.json()
        setAuthData(data)
        setDiscordEnabled(data.discord.enabled)
        setDiscordClientId(data.discord.clientId || "")
        setDiscordRedirectUri(data.discord.redirectUri || "")
        setDiscordClientSecret("") // reset replacement input

        setEmailEnabled(data.email.enabled)
        setEmailAllowReg(data.email.allowRegistration)
        setEmailMinPassLength(data.email.minPasswordLength)
      } else {
        toast.error("Failed to load authentication configuration.")
      }
    } catch {
      toast.error("Failed to fetch authentication settings.")
    } finally {
      setIsLoadingAuth(false)
    }
  }, [])

  React.useEffect(() => {
    fetchGeneralSettings()
    fetchAuthSettings()
  }, [fetchGeneralSettings, fetchAuthSettings])

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingGeneral(true)

    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          brand_name: brandName.trim(),
          panel_title: panelTitle.trim(),
          logo_url: logoUrl.trim(),
          favicon_url: faviconUrl.trim(),
          support_url: supportUrl.trim(),
          website_url: websiteUrl.trim(),
          discord_url: discordUrl.trim(),
          contact_email: contactEmail.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update platform settings.")

      await refreshSettings()
      toast.success("Platform settings saved successfully!")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error saving settings")
    } finally {
      setIsSavingGeneral(false)
    }
  }

  const handleSaveAuth = async (e: React.FormEvent) => {
    e.preventDefault()

    // Safety validation
    if (!discordEnabled && !emailEnabled) {
      toast.error("Cannot disable all authentication providers. At least one must be active.")
      return
    }

    if (discordEnabled && !discordClientId.trim() && !authData?.discord.isConfigured) {
      toast.error("Discord Client ID is required to enable Discord authentication.")
      return
    }

    setIsSavingAuth(true)

    try {
      const csrfRes = await fetch("/api/auth/csrf")
      let csrfToken = ""
      if (csrfRes.ok) {
        const c = await csrfRes.json()
        csrfToken = c.token
      }

      const payload: Record<string, unknown> = {
        discord: {
          enabled: discordEnabled,
          clientId: discordClientId.trim(),
          redirectUri: discordRedirectUri.trim(),
        },
        email: {
          enabled: emailEnabled,
          allowRegistration: emailAllowReg,
          minPasswordLength: Number(emailMinPassLength) || 8,
        },
      }

      if (discordClientSecret.trim()) {
        (payload.discord as Record<string, unknown>).clientSecret = discordClientSecret.trim()
      }

      const res = await fetch("/api/admin/settings/authentication", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update authentication settings.")

      toast.success("Authentication settings saved successfully!")
      await fetchAuthSettings()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error saving authentication settings")
    } finally {
      setIsSavingAuth(false)
    }
  }

  if (isLoadingGeneral && isLoadingAuth) {
    return (
      <BaseLayout title="Platform Settings" description="Global control panel configuration & branding" centered>
        <div className="py-24 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-primary" />
          Loading panel configuration...
        </div>
      </BaseLayout>
    )
  }

  return (
    <BaseLayout
      title="Platform Settings"
      description="Global panel branding, public identity, support links, and authentication provider configuration."
      centered
    >
      <div className="@container/main px-4 lg:px-6 max-w-4xl mx-auto w-full space-y-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <div className="border-b pb-3 mb-6">
            <div className="overflow-x-auto pb-0.5">
              <TabsList className="grid w-full min-w-[720px] grid-cols-5 h-10 p-1">
                <TabsTrigger value="general" className="gap-2 px-3">
                  <Settings2 className="size-4" />
                  General Settings
                </TabsTrigger>
                <TabsTrigger value="authentication" className="gap-2 px-3">
                  <KeyRound className="size-4" />
                  Authentication
                </TabsTrigger>
                <TabsTrigger value="api-keys" className="gap-2 px-3">
                  <Key className="size-4" />
                  API Keys
                </TabsTrigger>
                <TabsTrigger value="startup-script" className="gap-2 px-3">
                  <Terminal className="size-4" />
                  Startup Script
                </TabsTrigger>
                <TabsTrigger value="anti-miner" className="gap-2 px-3">
                  <ShieldAlert className="size-4" />
                  Anti-Miner
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          {/* ================================================================= */}
          {/* TAB 1: GENERAL SETTINGS */}
          {/* ================================================================= */}
          <TabsContent value="general" className="space-y-6 outline-none">
            <form onSubmit={handleSaveGeneral}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Globe className="size-4 text-primary" /> Branding & Identity
                  </CardTitle>
                  <CardDescription>
                    Customize visible platform names and logos. Updates reflect dynamically across all views.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Brand Name</Label>
                      <Input
                        value={brandName}
                        onChange={(e) => setBrandName(e.target.value)}
                        placeholder="e.g. InterDash"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Panel Window Title</Label>
                      <Input
                        value={panelTitle}
                        onChange={(e) => setPanelTitle(e.target.value)}
                        placeholder="e.g. InterDash — Cloud VPS Control Panel"
                      />
                    </div>
                  </div>

                  {/* Logo & Favicon Upload Blocks */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    {/* Custom Logo */}
                    <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold flex items-center gap-1.5">
                          <ImageIcon className="size-3.5 text-primary" /> Custom Logo
                        </Label>
                        {logoUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setLogoUrl("")
                              if (logoInputRef.current) logoInputRef.current.value = ""
                            }}
                            className="text-[11px] text-destructive hover:underline cursor-pointer"
                          >
                            Remove Logo
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded border border-border bg-background flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                          <ImagePreview src={logoUrl} fallbackText="Logo" />
                        </div>

                        <input
                          type="file"
                          ref={logoInputRef}
                          accept="image/*"
                          className="hidden"
                          onChange={handleLogoUpload}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1.5 shrink-0"
                          onClick={() => logoInputRef.current?.click()}
                        >
                          <Upload className="size-3.5" /> Upload Logo
                        </Button>

                        <Input
                          placeholder="or paste logo URL (e.g. https://i.imgur.com/...)"
                          value={logoUrl.startsWith("data:") ? "Custom logo uploaded" : logoUrl}
                          onChange={(e) => setLogoUrl(normalizeImageUrl(e.target.value))}
                          className="text-xs h-8 flex-1 font-mono"
                        />
                      </div>
                    </div>

                    {/* Favicon */}
                    <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold flex items-center gap-1.5">
                          <Globe className="size-3.5 text-primary" /> Favicon
                        </Label>
                        {faviconUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setFaviconUrl("")
                              if (faviconInputRef.current) faviconInputRef.current.value = ""
                            }}
                            className="text-[11px] text-destructive hover:underline cursor-pointer"
                          >
                            Remove Favicon
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded border border-border bg-background flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
                          <ImagePreview src={faviconUrl} fallbackText="Icon" isFavicon />
                        </div>

                        <input
                          type="file"
                          ref={faviconInputRef}
                          accept="image/*,.ico"
                          className="hidden"
                          onChange={handleFaviconUpload}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1.5 shrink-0"
                          onClick={() => faviconInputRef.current?.click()}
                        >
                          <Upload className="size-3.5" /> Upload Icon
                        </Button>

                        <Input
                          placeholder="or paste favicon URL (e.g. https://.../favicon.ico)"
                          value={faviconUrl.startsWith("data:") ? "Custom favicon uploaded" : faviconUrl}
                          onChange={(e) => setFaviconUrl(normalizeImageUrl(e.target.value))}
                          className="text-xs h-8 flex-1 font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Shield className="size-4 text-primary" /> Community & Support Endpoints
                  </CardTitle>
                  <CardDescription>
                    Links displayed across user dashboards, tickets, and external documentation.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Discord Server URL</Label>
                      <Input
                        value={discordUrl}
                        onChange={(e) => setDiscordUrl(e.target.value)}
                        placeholder="https://discord.gg/..."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Public Website URL</Label>
                      <Input
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="https://interenl.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Official Support URL</Label>
                      <Input
                        value={supportUrl}
                        onChange={(e) => setSupportUrl(e.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Support Contact Email</Label>
                      <Input
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="support@interenl.com"
                      />
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end border-t pt-4">
                  <Button type="submit" disabled={isSavingGeneral} className="gap-2">
                    {isSavingGeneral ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Save General Settings
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </TabsContent>

          {/* ================================================================= */}
          {/* TAB 2: AUTHENTICATION SETTINGS */}
          {/* ================================================================= */}
          <TabsContent value="authentication" className="space-y-6 outline-none">
            {/* Status Summary Banner */}
            <div className="rounded-lg border bg-card p-4 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <KeyRound className="size-4 text-primary" />
                    Active Authentication Providers
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Control how users access InterDash. At least one provider must remain enabled at all times.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={discordEnabled ? "default" : "outline"} className="gap-1">
                    {discordEnabled ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                    Discord: {discordEnabled ? "Active" : "Disabled"}
                  </Badge>
                  <Badge variant={emailEnabled ? "default" : "outline"} className="gap-1">
                    {emailEnabled ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
                    Email: {emailEnabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveAuth} className="space-y-6">
              {/* Discord OAuth Provider Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <svg className="size-4 text-[#5865F2] fill-current" viewBox="0 0 24 24">
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                        </svg>
                        Discord OAuth 2.0 Provider
                      </CardTitle>
                      <CardDescription>
                        Allow users to sign in with their Discord accounts. Credentials are encrypted at rest with AES-256-GCM.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label htmlFor="discord-toggle" className="text-xs font-medium cursor-pointer">
                        {discordEnabled ? "Enabled" : "Disabled"}
                      </Label>
                      <Switch
                        id="discord-toggle"
                        checked={discordEnabled}
                        onCheckedChange={(checked) => {
                          if (!checked && !emailEnabled) {
                            toast.error("Cannot disable Discord auth while Email auth is disabled.")
                            return
                          }
                          setDiscordEnabled(checked)
                        }}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {authData?.discord.source && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 px-3 py-2 rounded-md border">
                      <Lock className="size-3.5 text-primary" />
                      <span>Configuration Source:</span>
                      <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                        {authData.discord.source}
                      </Badge>
                      {authData.discord.hasClientSecret && (
                        <span className="text-emerald-500 flex items-center gap-1 font-medium ml-auto">
                          <CheckCircle2 className="size-3.5" /> Secret configured
                        </span>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="discord-client-id">Discord Client ID</Label>
                      <Input
                        id="discord-client-id"
                        value={discordClientId}
                        onChange={(e) => setDiscordClientId(e.target.value)}
                        placeholder="e.g. 123456789012345678"
                        className="font-mono text-xs"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Obtain from your Discord Developer Portal application settings.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="discord-client-secret">
                        Discord Client Secret
                        {authData?.discord.hasClientSecret && (
                          <span className="text-muted-foreground font-normal text-xs ml-2">
                            (Current: {authData.discord.clientSecretMasked})
                          </span>
                        )}
                      </Label>
                      <Input
                        id="discord-client-secret"
                        type="password"
                        value={discordClientSecret}
                        onChange={(e) => setDiscordClientSecret(e.target.value)}
                        placeholder={
                          authData?.discord.hasClientSecret
                            ? "Leave blank to keep existing secret"
                            : "Enter Discord application secret"
                        }
                        className="font-mono text-xs"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Secrets are never transmitted in cleartext and are securely encrypted.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <Label htmlFor="discord-redirect-uri">OAuth Redirect URI</Label>
                    <Input
                      id="discord-redirect-uri"
                      value={discordRedirectUri}
                      onChange={(e) => setDiscordRedirectUri(e.target.value)}
                      placeholder={authData?.discord.effectiveRedirectUri || "http://localhost:3000/api/auth/discord/callback"}
                      className="font-mono text-xs"
                    />
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      Must match the Redirect URI in Discord Developer Portal.
                      {authData?.discord.effectiveRedirectUri && (
                        <span className="text-foreground font-semibold">
                          Effective: {authData.discord.effectiveRedirectUri}
                        </span>
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Email & Password Authentication Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Mail className="size-4 text-primary" />
                        Email & Password Authentication
                      </CardTitle>
                      <CardDescription>
                        Standard email authentication with scrypt password hashing and timing-safe authentication.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label htmlFor="email-toggle" className="text-xs font-medium cursor-pointer">
                        {emailEnabled ? "Enabled" : "Disabled"}
                      </Label>
                      <Switch
                        id="email-toggle"
                        checked={emailEnabled}
                        onCheckedChange={(checked) => {
                          if (!checked && !discordEnabled) {
                            toast.error("Cannot disable Email auth while Discord auth is disabled.")
                            return
                          }
                          setEmailEnabled(checked)
                        }}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                      <div className="space-y-0.5">
                        <Label htmlFor="allow-registration" className="text-xs font-medium cursor-pointer">
                          Public User Registration
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          Allow visitors to create new accounts from the login page.
                        </p>
                      </div>
                      <Switch
                        id="allow-registration"
                        checked={emailAllowReg}
                        disabled={!emailEnabled}
                        onCheckedChange={setEmailAllowReg}
                      />
                    </div>

                    <div className="space-y-1.5 p-3 rounded-lg border bg-muted/20">
                      <Label htmlFor="min-password-length" className="text-xs font-medium">
                        Minimum Password Length
                      </Label>
                      <Input
                        id="min-password-length"
                        type="number"
                        min={8}
                        max={64}
                        value={emailMinPassLength}
                        disabled={!emailEnabled}
                        onChange={(e) => setEmailMinPassLength(Math.max(8, parseInt(e.target.value) || 8))}
                        className="text-xs h-8"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Enforced on all new registrations and password updates (min: 8).
                      </p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-between border-t pt-4">
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Shield className="size-3.5 text-primary" />
                    <span>Scrypt hashing (N=16384, r=8, p=1) with cryptographically secure random salt.</span>
                  </div>
                  <Button type="submit" disabled={isSavingAuth} className="gap-2">
                    {isSavingAuth ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Save Authentication Settings
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </TabsContent>

          {/* ================================================================= */}
          {/* TAB 3: API KEYS & EXTERNAL AUTOMATION */}
          {/* ================================================================= */}
          <TabsContent value="api-keys" className="space-y-6 outline-hidden">
            <ApiKeysManager />
          </TabsContent>

          {/* ================================================================= */}
          {/* TAB 4: STARTUP SCRIPT */}
          {/* ================================================================= */}
          <TabsContent value="startup-script" className="space-y-6 outline-hidden">
            <StartupScriptManager />
          </TabsContent>

          {/* ================================================================= */}
          {/* TAB 5: ANTI-MINER PROTECTION */}
          {/* ================================================================= */}
          <TabsContent value="anti-miner" className="space-y-6 outline-hidden">
            <AntiMinerManager />
          </TabsContent>
        </Tabs>
      </div>
    </BaseLayout>
  )
}
