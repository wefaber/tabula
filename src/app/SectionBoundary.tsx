import { Button } from '@wefaber/ui'
import { Component, type ReactNode } from 'react'

interface Props {
  /** Name of the module, so the failure says which one broke. */
  module: string
  children: ReactNode
}

/** A section that throws shows its own failure and leaves the rest of the panel usable. */
export class SectionBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-xl flex-col items-start gap-3 rounded-panel border border-border bg-surface p-5"
      >
        <h2 className="text-h3 font-semibold">
          {this.props.module} no se pudo mostrar
        </h2>
        <p className="text-muted">{error.message}</p>
        <Button onClick={() => this.setState({ error: null })}>
          Reintentar
        </Button>
      </div>
    )
  }
}
