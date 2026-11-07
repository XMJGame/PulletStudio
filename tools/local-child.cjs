// Windows child.kill() terminates immediately. IPC lets existing entry points
// finish their current step and close SQLite through their own SIGTERM hooks.
process.on('message', (message) => {
  if (message !== 'pullet-stop') return;
  process.disconnect?.();
  process.emit('SIGTERM');
});
require(require('node:path').resolve(process.argv[2]));
