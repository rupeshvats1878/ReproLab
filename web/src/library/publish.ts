import type { ApprovedProtocol } from '../prepare/library.ts'

export interface PublishFields {
  title: string
  description: string
  authorDisplayName: string
}

export interface PublishRequest {
  title: string
  description: string
  authorDisplayName: string
  approvalAcknowledged: true
  protocolSnapshot: ApprovedProtocol
}

export function publishRequest(protocol: ApprovedProtocol, fields: PublishFields): PublishRequest {
  return {
    title: fields.title.trim(),
    description: fields.description.trim(),
    authorDisplayName: fields.authorDisplayName.trim(),
    approvalAcknowledged: true,
    protocolSnapshot: {
      id: protocol.id,
      version: protocol.version,
      status: 'approved',
      title: protocol.title,
      sourceText: protocol.sourceText,
      steps: protocol.steps.map((step) => ({
        instruction: step.instruction,
        quote: step.quote,
        duration: step.duration,
        observationMethod: step.observationMethod,
        questions: [...step.questions],
      })),
      createdAt: protocol.createdAt,
      approvedAt: protocol.approvedAt,
    },
  }
}
