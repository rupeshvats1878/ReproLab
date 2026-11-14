export function experimentRecord(input, { id, publishedAt }) {
  return {
    id,
    title: input.title,
    description: input.description,
    authorDisplayName: input.authorDisplayName,
    approvalAcknowledged: true,
    protocolSnapshot: structuredClone(input.protocolSnapshot),
    publishedAt,
  }
}

export function replicationRecord(experiment, { id, createdAt }) {
  return {
    id,
    experimentId: experiment.id,
    protocolSnapshot: structuredClone(experiment.protocolSnapshot),
    status: 'planned',
    note: 'Planned replication. This record does not mean the experiment was performed or reproduced.',
    createdAt,
  }
}

export function experimentSummary(experiment) {
  return {
    id: experiment.id,
    title: experiment.title,
    description: experiment.description,
    authorDisplayName: experiment.authorDisplayName,
    approvalAcknowledged: experiment.approvalAcknowledged,
    publishedAt: experiment.publishedAt,
  }
}
