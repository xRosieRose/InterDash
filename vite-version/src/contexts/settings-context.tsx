"use client"

import * as React from "react"

export interface PanelSettings {
  brand_name: string
  panel_title: string
  logo_url: string
  favicon_url: string
  support_url: string
  website_url: string
  discord_url: string
  contact_email: string
}

const DEFAULT_SETTINGS: PanelSettings = {
  brand_name: "InterDash",
  panel_title: "Cloud VPS Control Panel",
  logo_url: "",
  favicon_url: "",
  support_url: "https://discord.gg/interenl",
  website_url: "https://interenl.com",
  discord_url: "https://discord.gg/interenl",
  contact_email: "support@interenl.com",
}

interface SettingsContextType {
  settings: PanelSettings
  isLoading: boolean
  refreshSettings: () => Promise<void>
}

const SettingsContext = React.createContext<SettingsContextType>({
  settings: DEFAULT_SETTINGS,
  isLoading: true,
  refreshSettings: async () => {},
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<PanelSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = React.useState(true)

  const refreshSettings = React.useCallback(async () => {
    try {
      const res = await fetch("/api/settings")
      if (res.ok) {
        const data = await res.json()
        if (data.settings) {
          const s: PanelSettings = {
            brand_name: data.settings.brand_name || DEFAULT_SETTINGS.brand_name,
            panel_title: data.settings.panel_title || DEFAULT_SETTINGS.panel_title,
            logo_url: data.settings.logo_url || "",
            favicon_url: data.settings.favicon_url || "",
            support_url: data.settings.support_url || DEFAULT_SETTINGS.support_url,
            website_url: data.settings.website_url || DEFAULT_SETTINGS.website_url,
            discord_url: data.settings.discord_url || DEFAULT_SETTINGS.discord_url,
            contact_email: data.settings.contact_email || DEFAULT_SETTINGS.contact_email,
          }
          setSettings(s)

          // Dynamically update document title
          if (s.panel_title) {
            document.title = s.panel_title
          }

          // Dynamically update favicon if configured
          if (s.favicon_url) {
            let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null
            if (!link) {
              link = document.createElement("link")
              link.rel = "icon"
              document.head.appendChild(link)
            }
            link.href = s.favicon_url
          }
        }
      }
    } catch (err) {
      console.error("[SETTINGS] Error loading panel settings:", err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refreshSettings()
  }, [refreshSettings])

  return (
    <SettingsContext.Provider value={{ settings, isLoading, refreshSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = React.useContext(SettingsContext)
  if (!context) {
    return { settings: DEFAULT_SETTINGS, isLoading: false, refreshSettings: async () => {} }
  }
  return context
}
