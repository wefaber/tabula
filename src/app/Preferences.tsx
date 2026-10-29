// Preferences: the gear in the header opens a dialog. Every change applies at once and is saved to the server.
import { Button, Dialog, IconButton } from '@wefaber/ui'
import { Compass, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n'
import { applyPrefs } from '@/lib/prefs'
import { usePrefs } from '@/lib/usePrefs'
import { openOnboarding } from './onboardingEvents'
import {
  ContrastGroup,
  LanguageGroup,
  ScaleGroup,
  ThemeGroup,
} from './PrefsControls'

/** Header button and its dialog. Also loads the server copy on mount so every page view uses the saved prefs. */
export function PreferencesButton() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const { prefs, server, choose, saveFailed } = usePrefs()

  useEffect(() => {
    if (server) applyPrefs(server)
  }, [server])

  return (
    <>
      <IconButton
        label={t('prefs.open')}
        icon={<Settings aria-hidden size={18} />}
        onClick={() => setOpen(true)}
      />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('prefs.title')}
        closeLabel={t('common.close')}
      >
        <LanguageGroup prefs={prefs} choose={choose} />
        <ThemeGroup prefs={prefs} choose={choose} />
        <ScaleGroup prefs={prefs} choose={choose} />
        <ContrastGroup prefs={prefs} choose={choose} />
        {saveFailed ? (
          <p role="alert" className="text-danger">
            {t('prefs.saveError')}
          </p>
        ) : null}
        <div className="flex justify-end border-t border-border pt-3">
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false)
              openOnboarding()
            }}
          >
            <Compass aria-hidden className="size-4" />
            {t('prefs.tour')}
          </Button>
        </div>
      </Dialog>
    </>
  )
}
