import { Search, X, Menu, Navigation2 } from 'lucide-react'
import { useState } from 'react'

interface SearchBarProps {
  value: string
  onChange: (val: string) => void
  onOpenSidebar: () => void
}

export default function SearchBar({ value, onChange, onOpenSidebar }: SearchBarProps) {
  const [focused, setFocused] = useState(false)

  return (
    <div
      className={`
        flex items-center gap-2 px-3 h-12 rounded-full
        bg-white/95 backdrop-blur-md border transition-all duration-200
        ${focused
          ? 'border-blue-400 shadow-[0_4px_20px_rgba(77,107,254,0.18)] ring-2 ring-blue-500/20'
          : 'border-slate-200/90 shadow-[0_2px_8px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-md hover:border-slate-300'
        }
      `}
    >
      {/* Integrated Hamburger Button */}
      <button
        onClick={onOpenSidebar}
        type="button"
        className="
          flex items-center justify-center w-8 h-8 rounded-full
          text-slate-600 hover:text-slate-900 hover:bg-slate-100
          transition-colors shrink-0 cursor-pointer
        "
        aria-label="Buka menu"
      >
        <Menu size={18} />
      </button>

      {/* Input Field */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Cari stasiun, rute, atau kereta..."
        className="flex-1 bg-transparent text-slate-800 placeholder-slate-400 text-sm outline-none font-medium min-w-0"
      />

      {/* Clear Button (when value exists) */}
      {value && (
        <button
          onClick={() => onChange('')}
          type="button"
          className="shrink-0 p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="Hapus pencarian"
        >
          <X size={15} />
        </button>
      )}

      {/* Vertical Divider */}
      <div className="w-px h-5 bg-slate-200 shrink-0" />

      {/* Search Icon / Button */}
      <button
        type="button"
        className="
          flex items-center justify-center w-8 h-8 rounded-full
          text-slate-500 hover:text-[#4D6BFE] hover:bg-blue-50
          transition-colors shrink-0
        "
        aria-label="Cari"
      >
        <Search size={17} />
      </button>

      {/* Direction / Route Button */}
      <button
        type="button"
        title="Petunjuk Rute"
        className="
          flex items-center justify-center w-8 h-8 rounded-full
          bg-[#EEF3FF] text-[#4D6BFE] hover:bg-[#DCE4FF]
          transition-colors shrink-0
        "
        aria-label="Rute"
      >
        <Navigation2 size={15} className="rotate-45" />
      </button>
    </div>
  )
}
