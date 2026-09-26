interface FitLogoProps {
  className?: string
}

export function FitLogo({ className }: FitLogoProps) {
  return <img
    className={['brand', className].filter(Boolean).join(' ')}
    src="/fit-logo.svg"
    alt=""
    aria-hidden="true"
  />
}
