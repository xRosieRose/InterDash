import { Heart } from "lucide-react"
import { Link } from "react-router-dom"
import { useSettings } from "@/contexts/settings-context"

export function SiteFooter() {
  const { settings } = useSettings()

  return (
    <footer className="border-t bg-background">
      <div className="px-4 py-6 lg:px-6">
        <div className="flex flex-col items-center justify-center space-y-2 text-center">
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <span>Made with</span>
            <Heart className="h-4 w-4 fill-red-500 text-red-500" />
            <span>by</span>
            <Link
              to="/landing"
              className="font-medium text-foreground hover:text-primary transition-colors"
            >
              {settings.brand_name || "InterDash"} Team
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            The hosting of your dreams, your own free VPS. Powered by high-speed NVMe cloud infrastructure.
          </p>
        </div>
      </div>
    </footer>
  )
}
