import { DEFAULT_CAPTURE_PROTOCOL_ID } from './threeCup.ts'

/** Researcher-specified handling requirements; independent of model observations. */
export const RECORDING_ONE_HANDLING_STEPS = [
  'Mix RED.',
  'Wipe the mixing tool.',
  'Mix BLUE.',
  'Wipe the mixing tool.',
  'Mix GREEN.',
  'Wipe the mixing tool.',
  'Pour RED into BLUE.',
  'Mix the contents of BLUE.',
  'Wipe the mixing tool.',
  'Pour GREEN into RED.',
  'Mix the contents of RED.',
] as const

export function ProcedureChecklist({ protocolId }: { protocolId: string }) {
  if (protocolId !== DEFAULT_CAPTURE_PROTOCOL_ID) return null
  return <section className="handling-procedure" aria-label="Full researcher-specified procedure">
    <h4>Full procedure</h4>
    <p className="capture-caption">Researcher-specified handling steps. Transfer analysis does not verify mixing or wiping.</p>
    <ol>{RECORDING_ONE_HANDLING_STEPS.map((step, index) => <li key={index}>{step}</li>)}</ol>
    <p className="capture-caption">Wipe between uses to reduce cross-contamination risk. Visible streaks in GREEN require appearance review; they do not prove chemical mixing completeness.</p>
    <p className="handling-review">Mixing &amp; cleaning: awaiting human review.</p>
  </section>
}
