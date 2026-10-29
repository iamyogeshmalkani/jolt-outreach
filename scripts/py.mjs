// Runs the Python finder with the project's own virtual environment, on Mac, Linux and Windows.
//   node scripts/py.mjs setup            create .venv and install requirements
//   node scripts/py.mjs <script args>    e.g. --login, --videos, --videos --every 60
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const win = process.platform === 'win32'
const venvPython = path.join('.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python')
const args = process.argv.slice(2)
const run = (bin, a) => spawnSync(bin, a, { stdio: 'inherit' }).status ?? 1

if (args[0] === 'setup') {
  const made = run(win ? 'py' : 'python3', ['-m', 'venv', '.venv'])
  if (made !== 0) {
    console.error('\nCould not create the Python environment. Install Python 3.9 or newer from python.org and try again.')
    process.exit(made)
  }
  process.exit(run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt']))
}

if (!existsSync(venvPython)) {
  console.error('Python is not set up yet. Run: npm run setup')
  process.exit(1)
}
process.exit(run(venvPython, ['jolt_outreach.py', ...args]))
