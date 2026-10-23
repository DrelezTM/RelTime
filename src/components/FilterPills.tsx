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
    activeColor: 'text-pink-900',
    activeBg: 'bg-pink-50',
    activeBorder: 'border-pink-400 ring-1 ring-pink-400/40',
    activeDot: 'bg-pink-500',
  },
  {
    id: 'commuter',
    label: 'Commuter',
    icon: <Train size={14} />,
    activeColor: 'text-[#3048C7]',
    activeBg: 'bg-[#EEF3FF]',
    activeBorder: 'border-[#4D6BFE] ring-1 ring-[#4D6BFE]/40',
    activeDot: 'bg-[#4D6BFE]',
  },
  {
    id: 'jarak-jauh',
    label: 'Kereta Jarak Jauh',
    icon: <Compass size={14} />,
    activeColor: 'text-purple-900',
    activeBg: 'bg-purple-50',
    activeBorder: 'border-purple-400 ring-1 ring-purple-400/40',
    activeDot: 'bg-purple-500',
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
                : 'text-slate-700 bg-white/95 border-slate-200/90 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:bg-slate-50 hover:border-slate-300'
              }
            `}
            aria-pressed={isActive}
          >
            <span className={`shrink-0 ${isActive ? '' : 'text-slate-500'}`}>
              {f.icon}
            </span>
            <span>{f.label}</span>
            {isActive ? (
              <span className={`w-1.5 h-1.5 rounded-full ${f.activeDot} shrink-0 ml-0.5`} />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full border border-slate-300 shrink-0 ml-0.5" />
            )}
          </button>
        )
      })}
    </div>
  )
}
