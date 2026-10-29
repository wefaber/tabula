import { Dialog, isTyping, Kbd } from '@wefaber/ui'
import { useEffect, useState } from 'react'
import { SECTIONS } from '@/features/registry'
import { useT } from '@/lib/i18n'

/** Hash navigation by keyboard plus the help dialog. Ignored while typing and with any modifier held. */
export function Shortcuts({ active }: { active: string }) {
  const t = useT()
  const [help, setHelp] = useState(false)
  /** What the help dialog lists: the shell's own shortcuts and the ones sections add. */
  const GLOBAL: { keys: string; what: string }[] = [
    { keys: '1', what: t('shortcuts.section') },
    { keys: '[', what: t('shortcuts.prev') },
    { keys: ']', what: t('shortcuts.next') },
    { keys: '?', what: t('shortcuts.help') },
    { keys: 'Enter', what: t('shortcuts.send') },
  ]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      if (document.querySelector('dialog[open]')) return
      const go = (id?: string) => {
        if (id) window.location.hash = id
      }
      const index = SECTIONS.findIndex((s) => s.id === active)
      if (e.key === '?') setHelp(true)
      else if (e.key === '[')
        go(SECTIONS[(index - 1 + SECTIONS.length) % SECTIONS.length]?.id)
      else if (e.key === ']') go(SECTIONS[(index + 1) % SECTIONS.length]?.id)
      else if (/^[1-9]$/.test(e.key)) go(SECTIONS[Number(e.key) - 1]?.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  return (
    <Dialog
      open={help}
      onClose={() => setHelp(false)}
      title={t('shortcuts.title')}
      closeLabel={t('common.close')}
    >
      <ul className="flex flex-col gap-2">
        {GLOBAL.map(({ keys, what }) => (
          <li key={keys} className="flex items-center justify-between gap-4">
            <span>{what}</span>
            <Kbd keys={keys} />
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
