import { useSearchParams } from 'react-router-dom'

// Keeps the selected assignment in the URL (?assignment=<id>) so screens can
// link to each other with the same assignment already chosen.
export function useAssignmentParam(): [string, (id: string) => void] {
  const [params, setParams] = useSearchParams()
  const id = params.get('assignment') ?? ''
  return [
    id,
    (next: string) =>
      setParams(
        (previous) => {
          const copy = new URLSearchParams(previous)
          if (next) copy.set('assignment', next)
          else copy.delete('assignment')
          return copy
        },
        { replace: true },
      ),
  ]
}
