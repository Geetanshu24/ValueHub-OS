import type { ScreenRoute } from '../routes.tsx'

export default function Placeholder({ screen }: { screen: ScreenRoute }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{screen.label}</h1>
      <p className="mt-2 text-base text-ink-soft">Not built yet — planned for phase {screen.phase}.</p>
    </div>
  )
}
