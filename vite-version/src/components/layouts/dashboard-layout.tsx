"use client"

import * as React from "react"
import { Suspense } from "react"
import { Outlet } from "react-router-dom"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { ThemeCustomizer, ThemeCustomizerTrigger } from "@/components/theme-customizer"
import { useSidebarConfig } from "@/hooks/use-sidebar-config"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { PageSkeleton } from "@/components/ui/page-skeleton"

interface DashboardShellContextValue {
  isInsideShell: boolean
}

export const DashboardShellContext = React.createContext<DashboardShellContextValue>({
  isInsideShell: false,
})

export function useDashboardShell() {
  return React.useContext(DashboardShellContext)
}

export function DashboardLayout() {
  const [themeCustomizerOpen, setThemeCustomizerOpen] = React.useState(false)
  const { config } = useSidebarConfig()

  return (
    <DashboardShellContext.Provider value={{ isInsideShell: true }}>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "16rem",
            "--sidebar-width-icon": "3rem",
            "--header-height": "calc(var(--spacing) * 14)",
          } as React.CSSProperties
        }
        className={config.collapsible === "none" ? "sidebar-none-mode" : ""}
      >
        {config.side === "left" ? (
          <>
            <AppSidebar
              variant={config.variant}
              collapsible={config.collapsible}
              side={config.side}
            />
            <SidebarInset>
              <SiteHeader />
              <div className="flex flex-1 flex-col">
                <div className="@container/main flex flex-1 flex-col gap-2">
                  <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
                    <Suspense fallback={<PageSkeleton />}>
                      <Outlet />
                    </Suspense>
                  </div>
                </div>
              </div>
              <SiteFooter />
            </SidebarInset>
          </>
        ) : (
          <>
            <SidebarInset>
              <SiteHeader />
              <div className="flex flex-1 flex-col">
                <div className="@container/main flex flex-1 flex-col gap-2">
                  <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
                    <Suspense fallback={<PageSkeleton />}>
                      <Outlet />
                    </Suspense>
                  </div>
                </div>
              </div>
              <SiteFooter />
            </SidebarInset>
            <AppSidebar
              variant={config.variant}
              collapsible={config.collapsible}
              side={config.side}
            />
          </>
        )}
        <ThemeCustomizer
          open={themeCustomizerOpen}
          onOpenChange={setThemeCustomizerOpen}
        />
        <ThemeCustomizerTrigger
          onClick={() => setThemeCustomizerOpen(true)}
        />
      </SidebarProvider>
    </DashboardShellContext.Provider>
  )
}
