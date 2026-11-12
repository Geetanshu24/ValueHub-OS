import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AlertOctagon, AlertTriangle, CheckCircle, Info } from 'lucide-react'

type Kind = 'info' | 'success' | 'warning' | 'error'
interface Item { id: number; message: string; kind: Kind }
const ToastContext = createContext<(message: string, kind?: Kind) => void>(() => undefined)
export const useToast = () => useContext(ToastContext)

const STYLE: Record<Kind, string> = { info: 'border-blue-500', success: 'border-emerald-600', warning: 'border-amber-500', error: 'border-red-600' }
const ICON: Record<Kind, ReactNode> = {
  info: <Info className="h-4 w-4 text-blue-600" />, success: <CheckCircle className="h-4 w-4 text-emerald-600" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-600" />, error: <AlertOctagon className="h-4 w-4 text-brand-red" />,
}

// Small messages in the top right that go away by themselves, as in the prototype.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const show = useCallback((message: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((list) => [...list, { id, message, kind }])
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), 3400)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed right-5 top-20 z-[60] flex flex-col space-y-2" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`pointer-events-auto flex items-center space-x-3 rounded-xl border-l-4 bg-white p-3 text-xs font-semibold text-slate-900 shadow-xl ${STYLE[i.kind]}`}>
            <div className="shrink-0">{ICON[i.kind]}</div>
            <div className="flex-1">{i.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
