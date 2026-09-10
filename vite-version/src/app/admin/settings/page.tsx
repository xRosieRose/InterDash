"use client"

import * as React from "react"
import { Save, Loader2, Globe, Shield } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"

export default function AdminSettingsPage() {
  const [brandName, setBrandName] = React.useState("InterENL")
  const [panelTitle, setPanelTitle] = React.useState("InterDash — Cloud VPS Control Panel")
  const [logoUrl, setLogoUrl] = React.useState("")
  const [faviconUrl, setFaviconUrl] = React.useState("")
  const [supportUrl, setSupportUrl] = React.useState("https://discord.gg/interenl")
  const [websiteUrl, setWebsiteUrl] = React.useState("https://interenl.com")
  const [discordUrl, setDiscordUrl] = React.useState("https://discord.gg/interenl")
  const [contactEmail, setContactEmail] = React.useState("support@interenl.com")

  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  const fetchSettings = React.useCallback(async () => {
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
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

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
      if (!res.ok) throw new Error(data.error || "Failed to update settings.")

      toast.success("Platform settings saved successfully!")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error saving settings")
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
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
      description="Global panel branding, public identity, support links, and communication endpoints."
      centered
    >
      <div className="@container/main px-4 lg:px-6 max-w-4xl mx-auto w-full space-y-6">
        <form onSubmit={handleSave}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Globe className="size-4 text-primary" /> Branding & Identity
              </CardTitle>
              <CardDescription>
                Customize visible platform names and logos. Updates reflect dynamically without code changes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Brand Name</Label>
                  <Input
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="e.g. InterENL"
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Custom Logo URL (Optional)</Label>
                  <Input
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Favicon URL (Optional)</Label>
                  <Input
                    value={faviconUrl}
                    onChange={(e) => setFaviconUrl(e.target.value)}
                    placeholder="https://..."
                  />
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
              <Button type="submit" disabled={isSaving} className="gap-2">
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save Platform Settings
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </BaseLayout>
  )
}
