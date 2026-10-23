export type ThemeMode = 'system' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'reltime_theme_mode'

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY)
    if (val === 'light' || val === 'dark' || val === 'system') return val
  } catch {
    // ignore local storage errors
  }
  return 'system'
}

export function setStoredTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // ignore local storage errors
  }
}

export function resolveEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}
