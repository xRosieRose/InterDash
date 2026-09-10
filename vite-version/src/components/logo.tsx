import * as React from "react"
import { useSettings } from "@/contexts/settings-context"

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number
  forceSvg?: boolean
}

export function Logo({ size = 24, className, forceSvg = false, ...props }: LogoProps) {
  const { settings } = useSettings()
  const [triedProxy, setTriedProxy] = React.useState(false)
  const [hasError, setHasError] = React.useState(false)

  React.useEffect(() => {
    setTriedProxy(false)
    setHasError(false)
  }, [settings?.logo_url])

  const rawUrl = settings?.logo_url
  let displaySrc = rawUrl
  if (triedProxy && rawUrl && !rawUrl.startsWith("data:")) {
    displaySrc = `/api/settings/proxy-image?url=${encodeURIComponent(rawUrl)}`
  }

  if (!forceSvg && displaySrc && !hasError) {
    return (
      <img
        src={displaySrc}
        alt={settings.brand_name || "Logo"}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => {
          if (!triedProxy && rawUrl && !rawUrl.startsWith("data:")) {
            setTriedProxy(true)
          } else {
            setHasError(true)
          }
        }}
        style={{ width: size, height: size, objectFit: "contain" }}
        className={`rounded shrink-0 ${className || ""}`}
      />
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      {/* Top Server Node */}
      <rect x="3" y="4" width="26" height="6" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.12" />
      <circle cx="7.5" cy="7" r="1.2" fill="currentColor" />
      <circle cx="11.5" cy="7" r="1.2" fill="currentColor" />
      <line x1="20" y1="7" x2="25" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />

      {/* Middle Server Node */}
      <rect x="3" y="13" width="26" height="6" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.12" />
      <circle cx="7.5" cy="16" r="1.2" fill="currentColor" />
      <circle cx="11.5" cy="16" r="1.2" fill="currentColor" />
      <line x1="20" y1="16" x2="25" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />

      {/* Bottom Server Node */}
      <rect x="3" y="22" width="26" height="6" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.12" />
      <circle cx="7.5" cy="25" r="1.2" fill="currentColor" />
      <circle cx="11.5" cy="25" r="1.2" fill="currentColor" />
      <line x1="20" y1="25" x2="25" y2="25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
