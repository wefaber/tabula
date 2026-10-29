// The window event that reopens the first-use tour. Kept apart from Onboarding.tsx so that file only exports its component.
export const OPEN_ONBOARDING_EVENT = 'tabula:onboarding'

/** Abre el recorrido aunque ya se haya visto. Lo llama el diálogo de atajos. */
export function openOnboarding(): void {
  window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT))
}
