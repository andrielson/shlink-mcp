import { afterEach, describe, expect, test } from 'bun:test'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveTestsIdentity } from './compose-project.ts'

// Hermetic unit tests for the integration harness's identity record — the
// one piece of tests/ logic that must hold on its own: parallel worktrees
// and manual compose invocations both depend on generate-once, reuse-after.

let scratch: string | undefined

afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
})

function envPath(): string {
  scratch = mkdtempSync(join(tmpdir(), 'shlink-mcp-identity-'))
  return join(scratch, '.env')
}

describe('resolveTestsIdentity', () => {
  test('generates and records a fresh identity when no record exists', async () => {
    const path = envPath()

    const identity = await resolveTestsIdentity(path)

    expect(identity.project).toMatch(/^shlink-mcp-tests-[0-9a-f]{8}$/)
    expect(identity.port).toBeGreaterThanOrEqual(18100)
    expect(identity.port).toBeLessThanOrEqual(19999)
    expect(await Bun.file(path).text()).toBe(
      `COMPOSE_PROJECT_NAME=${identity.project}\nSHLINK_TEST_PORT=${identity.port}\n`,
    )
  })

  test('reuses the recorded identity on the next call', async () => {
    const path = envPath()

    const first = await resolveTestsIdentity(path)
    const second = await resolveTestsIdentity(path)

    expect(second).toEqual(first)
  })

  test('regenerates a partial record (project without port)', async () => {
    const path = envPath()
    await Bun.write(path, 'COMPOSE_PROJECT_NAME=shlink-mcp-tests-deadbeef\n')

    const identity = await resolveTestsIdentity(path)

    expect(identity.project).not.toBe('shlink-mcp-tests-deadbeef')
    expect(await Bun.file(path).text()).toBe(
      `COMPOSE_PROJECT_NAME=${identity.project}\nSHLINK_TEST_PORT=${identity.port}\n`,
    )
  })

  test('regenerates when the port is not a number', async () => {
    const path = envPath()
    await Bun.write(path, 'COMPOSE_PROJECT_NAME=shlink-mcp-tests-deadbeef\nSHLINK_TEST_PORT=not-a-port\n')

    const identity = await resolveTestsIdentity(path)

    expect(typeof identity.port).toBe('number')
    expect(Number.isInteger(identity.port)).toBe(true)
  })
})
