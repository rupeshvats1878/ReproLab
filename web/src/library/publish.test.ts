import { describe, expect, it } from 'vitest'
import type { ApprovedProtocol } from '../prepare/library.ts'
import { publishRequest } from './publish.ts'

const approved: ApprovedProtocol = {
  id: 'proto_1',
  version: 1,
  status: 'approved',
  title: 'Cup check',
  sourceText: 'Stir cup A for 10 seconds. Mix cup B thoroughly.',
  steps: [
    {
      instruction: 'Stir cup A for 10 seconds.',
      quote: 'Stir cup A for 10 seconds.',
      duration: '10 seconds',
      observationMethod: 'timer',
      questions: [],
    },
    {
      instruction: 'Mix cup B thoroughly.',
      quote: 'Mix cup B thoroughly.',
      duration: null,
      observationMethod: 'manual',
      questions: ['How long should cup B be mixed?'],
    },
  ],
  createdAt: '2026-11-14T12:00:00.000Z',
  approvedAt: '2026-11-14T12:05:00.000Z',
}

describe('publish request', () => {
  it('sends one approved version and keeps a missing duration null', () => {
    const request = publishRequest(approved, {
      title: ' Cup check ',
      description: ' Two cups. ',
      authorDisplayName: ' Ada ',
    })
    expect(request.approvalAcknowledged).toBe(true)
    expect(request.title).toBe('Cup check')
    expect(request.protocolSnapshot.version).toBe(1)
    expect(request.protocolSnapshot.status).toBe('approved')
    expect(request.protocolSnapshot.steps[0]?.duration).toBe('10 seconds')
    expect(request.protocolSnapshot.steps[1]?.duration).toBeNull()
    request.protocolSnapshot.steps[1]!.duration = '5 minutes'
    expect(approved.steps[1]?.duration).toBeNull()
  })
})
