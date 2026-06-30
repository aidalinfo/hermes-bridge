#!/usr/bin/env node
import { runInstall } from './install.js'

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg)
    if (match && match[1] && match[2]) out[match[1]] = match[2]
  }
  return out
}

const argv = process.argv.slice(2)
const command = argv[0]
const rest = argv.slice(1)

if (command === 'install') {
  const args = parseArgs(rest)
  if (!args.token || !args['relay-url']) {
    console.error('Usage: hermes-bridge install --token=<token> --relay-url=<wss://...>')
    process.exit(1)
  }
  runInstall({ token: args.token, relayUrl: args['relay-url'], dataDir: args['data-dir'] })
  console.log('hermes-bridge adapter installed. Restart the bot container to load the plugin.')
} else {
  console.error(`Unknown command: ${command ?? '(none)'}`)
  console.error('Usage: hermes-bridge install --token=<token> --relay-url=<wss://...>')
  process.exit(1)
}
