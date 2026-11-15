import type { ProtocolStep } from './validate.ts'

export const SIX_WELL_INSTRUCTIONS = ['Fill A1', 'Fill A2', 'Fill A3', 'Fill B1', 'Fill B2', 'Fill B3'] as const

export const SIX_WELL_TITLE = 'Six-well colored water'

export interface PreparedMonitorProtocol {
  id: string
  version: number
  title: string
  steps: readonly string[]
}

export function sixWellDraft(): { title: string; sourceText: string; steps: ProtocolStep[] } {
  const sourceText = SIX_WELL_INSTRUCTIONS.join('\n')
  return {
    title: SIX_WELL_TITLE,
    sourceText,
    steps: SIX_WELL_INSTRUCTIONS.map((instruction) => ({
      instruction,
      quote: instruction,
      duration: null,
      observationMethod: 'manual',
      questions: [],
    })),
  }
}

/** The supported procedure is these six instructions in order, with no stated duration. */
export function isSupportedSixWell(steps: readonly ProtocolStep[]): boolean {
  return (
    steps.length === SIX_WELL_INSTRUCTIONS.length &&
    steps.every((step, index) => step.instruction.trim() === SIX_WELL_INSTRUCTIONS[index] && step.duration == null)
  )
}

export function monitorProtocolFromInstructions(steps: readonly { instruction?: string }[] | undefined, id: string, version: number, title: string): PreparedMonitorProtocol | null {
  if (!steps || steps.length !== SIX_WELL_INSTRUCTIONS.length) return null
  if (!steps.every((step, index) => step.instruction?.trim() === SIX_WELL_INSTRUCTIONS[index])) return null
  return { id, version, title, steps: [...SIX_WELL_INSTRUCTIONS] }
}

export function preparedMonitorProtocol(id: string, version: number, title: string, steps: readonly ProtocolStep[]): PreparedMonitorProtocol {
  return {
    id,
    version,
    title,
    steps: steps.map((step) => step.instruction.trim()),
  }
}
