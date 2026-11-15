/** Run synthetic acceptance probes against an explicitly selected parser snapshot. */
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const [snapshotPath, reportPath] = process.argv.slice(2)
if (!snapshotPath || !reportPath) {
  throw new Error('Usage: node probe_integration.mjs PARSER_SNAPSHOT.ts REPORT.json')
}
const fixtures = JSON.parse(await readFile(
  new URL('./tests/fixtures/integration_cases.json', import.meta.url), 'utf8'))
const { reviewModelObservation } = await import(pathToFileURL(resolve(snapshotPath)).href)
const results = fixtures.cases.map((fixture) => {
  if (fixture.layer === 'request_wrapper') {
    return { name: fixture.name, status: 'blocked', reason: 'Request wrapper is absent from this parser contract' }
  }
  try {
    const actual = reviewModelObservation(fixture.payload, fixture.expected)
    const timePreserved = fixture.expectedFirstEventStartMs === undefined ||
      actual.events[0]?.eventStartMs === fixture.expectedFirstEventStartMs
    return {
      name: fixture.name,
      expectedState: fixture.expectedState,
      actualState: actual.state,
      status: actual.state === fixture.expectedState && timePreserved ? 'passed' : 'gap',
      actual,
    }
  } catch (error) {
    return { name: fixture.name, status: 'gap', error: String(error) }
  }
})
const report = { synthetic: true, cursorCommit: fixtures.cursorCommit, results }
await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(results.map(({ name, status }) => ({ name, status })), null, 2))
process.exitCode = results.some((result) => result.status !== 'passed') ? 1 : 0
