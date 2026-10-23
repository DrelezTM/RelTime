import { MapPin, Train, Compass } from 'lucide-react'

export type FilterType = 'stasiun' | 'commuter' | 'jarak-jauh'

interface FilterPill {
  id: FilterType
  label: string
  icon: React.ReactNode
  activeColor: string
  activeBg: string
  activeBorder: string
  activeDot: string
}

const filters: FilterPill[] = [
  {
    id: 'stasiun',
    label: 'Stasiun',
    icon: <MapPin size={14} />,
    activeColor: 'text-pink-900 dark:text-pink-100',
    activeBg: 'bg-pink-50 dark:bg-pink-950/70',
    activeBorder: 'border-pink-400 dark:border-pink-500 ring-1 ring-pink-400/40 dark:ring-pink-500/40',
    activeDot: 'bg-pink-500 dark:bg-pink-400',
  },
  {
    id: 'commuter',
    label: 'Commuter',
    icon: <Train size={14} />,
    activeColor: 'text-[#3048C7] dark:text-blue-100',
    activeBg: 'bg-[#EEF3FF] dark:bg-blue-950/70',
    activeBorder: 'border-[#4D6BFE] dark:border-blue-500 ring-1 ring-[#4D6BFE]/40 dark:ring-blue-500/40',
    activeDot: 'bg-[#4D6BFE] dark:bg-blue-400',
  },
  {
    id: 'jarak-jauh',
    label: 'Kereta Jarak Jauh',
    icon: <Compass size={14} />,
    activeColor: 'text-purple-900 dark:text-purple-100',
    activeBg: 'bg-purple-50 dark:bg-purple-950/70',
    activeBorder: 'border-purple-400 dark:border-purple-500 ring-1 ring-purple-400/40 dark:ring-purple-500/40',
    activeDot: 'bg-purple-500 dark:bg-purple-400',
  },
]

interface FilterPillsProps {
  selected: FilterType[]
  onChange: (selected: FilterType[]) => void
}

export default function FilterPills({ selected, onChange }: FilterPillsProps) {
  const toggle = (id: FilterType) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className="flex items-center gap-2 flex-nowrap whitespace-nowrap overflow-x-auto no-scrollbar py-0.5">
      {filters.map((f) => {
        const isActive = selected.includes(f.id)
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => toggle(f.id)}
            className={`
              inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full text-xs font-semibold
              border backdrop-blur-md transition-all duration-150 cursor-pointer shrink-0 select-none
              ${isActive
                ? `${f.activeColor} ${f.activeBg} ${f.activeBorder} shadow-sm`
                : 'text-slate-700 dark:text-slate-200 bg-white/95 dark:bg-slate-900/95 border-slate-200/90 dark:border-slate-800 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }
            `}
            aria-pressed={isActive}
          >
            <span className={`shrink-0 ${isActive ? '' : 'text-slate-500 dark:text-slate-400'}`}>
              {f.icon}
            </span>
            <span>{f.label}</span>
            {isActive ? (
              <span className={`w-1.5 h-1.5 rounded-full ${f.activeDot} shrink-0 ml-0.5`} />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full border border-slate-300 dark:border-slate-600 shrink-0 ml-0.5" />
            )}
          </button>
        )
      })}
    </div>
  )
}
