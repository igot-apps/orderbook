const path = require('node:path');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const [target, command, ...args] = process.argv.slice(2);
if (!['local', 'staging', 'production'].includes(target) || !['tsx', 'prisma'].includes(command)) {
  console.error('Usage: with-database.cjs <local|staging|production> <tsx|prisma> [arguments]');
  process.exit(1);
}
const databaseUrl = target === 'production'
  ? process.env.DATABASE_URL_PRODUCTION
  : target === 'staging'
    ? process.env.DATABASE_URL_STAGING
    : process.env.DATABASE_URL_LOCAL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(`Set DATABASE_URL_${target.toUpperCase()} in backend/.env first.`);
  process.exit(1);
}
console.log(`Using ${target} database`);
const cli = command === 'tsx' ? require.resolve('tsx/cli') : path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
const child = spawn(process.execPath, [cli, ...args], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});
child.on('error', () => { console.error('Could not start database command.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
