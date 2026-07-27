import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme, type ThemePreference } from '../contexts/ThemeContext';

const themeIcons: Record<ThemePreference, ReactNode> = {
  system: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
};

export default function ThemeToggle() {
  const { preference, cycleTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <>
      <button
        className="theme-toggle"
        onClick={cycleTheme}
        aria-label={t('theme.toggle', { mode: t(`theme.${preference}`) })}
        title={t(`theme.${preference}`)}
      >
        <span className="theme-icon">
          {themeIcons[preference]}
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {t('theme.toggle', { mode: t(`theme.${preference}`) })}
      </span>
    </>
  );
}
