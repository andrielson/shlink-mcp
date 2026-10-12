// The integration suite's compose plumbing: the per-worktree compose
// identity (wayfinder #8, adopting rtx-workspace's ADR 0010 pattern and
// extending it to the published host port), the ephemeral Shlink lifecycle,
// and the env contract for where the suite finds that Shlink.
//
// The identity — project name plus published port — is generated once,
// recorded in the gitignored tests/.env, and reused from then on. Parallel
// worktrees therefore each own their ephemeral Shlink (no Docker-global
// collisions), and manual `docker compose --file tests/compose.yaml`
// invocations aim at the same project and port as the suite, because
// compose auto-loads that .env from the compose file's directory.

import { $ } from 'bun'

export type TestsIdentity = { project: string; port: number }

const PROJECT_PREFIX = 'shlink-mcp-tests-'
// A random high unprivileged range, kept clear of the 18080 default the
// README documents for manually started instances.
const PORT_MIN = 18100
const PORT_MAX = 19999

export const testsEnvPath = `${import.meta.dir}/.env`

export async function resolveTestsIdentity(envPath: string = testsEnvPath): Promise<TestsIdentity> {
  // A missing or unreadable record is simply a fresh identity.
  let content = ''
  try {
    content = await Bun.file(envPath).text()
  } catch {
    // Fall through to generation.
  }
  const project = /^COMPOSE_PROJECT_NAME=(shlink-mcp-tests-[0-9a-f]{8})$/m.exec(content)?.[1]
  const port = /^SHLINK_TEST_PORT=(\d{1,5})$/m.exec(content)?.[1]
  if (project !== undefined && port !== undefined) return { project, port: Number(port) }

  // 32 random bits drive both halves of the identity, so one draw can never
  // produce a project/port mismatch.
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))
  const identity: TestsIdentity = {
    project: `${PROJECT_PREFIX}${value.toString(16).padStart(8, '0')}`,
    port: PORT_MIN + (value % (PORT_MAX - PORT_MIN + 1)),
  }
  await Bun.write(envPath, `COMPOSE_PROJECT_NAME=${identity.project}\nSHLINK_TEST_PORT=${identity.port}\n`)
  return identity
}

// Every suite invocation goes through this prefix, so a stray exported
// COMPOSE_PROJECT_NAME in the shell can never hijack the identity.
function composeArgs(identity: TestsIdentity): string[] {
  return ['docker', 'compose', '--file', `${import.meta.dir}/compose.yaml`, '--project-name', identity.project]
}

// The Shlink the suite talks to: SHLINK_TEST_HOST (default 127.0.0.1; this
// workspace sets 172.18.0.1, the docker-host gateway of the remote daemon)
// plus the per-worktree recorded port — or SHLINK_TEST_BASE_URL as a total
// override pointing at an already-running external instance.
export function shlinkTarget(identity: TestsIdentity): { baseUrl: string; apiKey: string } {
  const apiKey = process.env.SHLINK_TEST_API_KEY ?? 'shlink-mcp-test-key'
  const override = process.env.SHLINK_TEST_BASE_URL
  if (override !== undefined && override !== '') return { baseUrl: override, apiKey }
  const host = process.env.SHLINK_TEST_HOST ?? '127.0.0.1'
  return { baseUrl: `http://${host}:${identity.port}`, apiKey }
}

// With a total base-URL override the instance is externally managed: the
// suite must not start or stop one of its own.
export function externallyManagedShlink(): boolean {
  const override = process.env.SHLINK_TEST_BASE_URL
  return override !== undefined && override !== ''
}

export async function startEphemeralShlink(identity: TestsIdentity): Promise<void> {
  const compose = composeArgs(identity)
  // Defensive teardown first: afterAll does not run under SIGKILL, and the
  // stable per-worktree identity lets this run clean a crashed predecessor.
  await $`${compose} down --remove-orphans`.quiet().nothrow()
  // The recorded port is passed explicitly as well, so the programmatic path
  // never depends on compose's .env auto-load.
  await $`${compose} up --detach --wait`.env({ ...process.env, SHLINK_TEST_PORT: String(identity.port) })
}

export async function stopEphemeralShlink(identity: TestsIdentity): Promise<void> {
  const compose = composeArgs(identity)
  // Best effort: teardown must not mask the test failures that led here.
  await $`${compose} down --remove-orphans`.quiet().nothrow()
}
