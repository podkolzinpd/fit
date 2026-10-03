// Critical styles live in index.html: the same photograph must paint before JS
// and stay unchanged while React restores the session. Never gate auth on an image.
export function StartupSplash() {
  return <main className="fit-startup-photo" role="status" aria-label="Загружаем Fit">
    <span>Загружаем Fit…</span>
    <img
      className="fit-startup-photo-image"
      src="/assets/startup-photo-983c93dc4df8.jpg"
      width="940"
      height="1673"
      alt=""
      aria-hidden="true"
      fetchPriority="high"
      onError={(event) => { event.currentTarget.hidden = true }}
    />
  </main>
}
