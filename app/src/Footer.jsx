export default function Footer() {
  return (
    <footer className="mt-12 border-t border-neutral-200 px-4 py-6 text-center text-xs text-neutral-400 dark:border-neutral-800">
      <p>
        Personal, non-commercial fan project. Not affiliated with, endorsed
        by, or sponsored by the NFL or any NFL team. Team names, logos, and
        marks are the property of their respective owners.
      </p>
      <p className="mt-1">
        Stats sourced from{' '}
        <a
          href="https://github.com/nflverse"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-neutral-600 dark:hover:text-neutral-200"
        >
          nflverse
        </a>
        .
      </p>
    </footer>
  )
}
