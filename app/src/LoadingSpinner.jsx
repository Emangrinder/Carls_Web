// Centered loading indicator for the main content area (between the top
// ribbon and the left nav bar), used in place of a plain "Loading…" text
// on every page while its data is in flight.
export default function LoadingSpinner({ full = false }) {
  return (
    <div className={`flex items-center justify-center ${full ? 'min-h-[60vh]' : 'py-12'}`}>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-500 dark:border-neutral-800 dark:border-t-neutral-400" />
    </div>
  )
}
