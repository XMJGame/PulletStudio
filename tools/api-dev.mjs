import ts from 'typescript';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('../apps/api/', import.meta.url));
const format = { getCanonicalFileName: (x) => x, getCurrentDirectory: () => apiRoot, getNewLine: () => '\n' };
let child;
let restarting = Promise.resolve();
let stopping = false;
const host = ts.createWatchCompilerHost(
  `${apiRoot}/tsconfig.json`,
  {},
  ts.sys,
  ts.createSemanticDiagnosticsBuilderProgram,
  (diagnostic) => console.error(ts.formatDiagnostic(diagnostic, format)),
  (diagnostic) => console.log(ts.formatDiagnostic(diagnostic, format)),
);
const original = host.afterProgramCreate;
host.afterProgramCreate = (program) => {
  original?.(program);
  if (ts.getPreEmitDiagnostics(program.getProgram()).some((x) => x.category === ts.DiagnosticCategory.Error))
    return;
  restarting = restarting.then(async () => {
    if (child && child.exitCode === null && child.signalCode === null)
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill();
      });
    if (!stopping)
      child = spawn(process.execPath, [`${apiRoot}/dist/main.js`], {
        cwd: apiRoot,
        stdio: 'inherit',
        windowsHide: true,
      });
  });
};
const watcher = ts.createWatchProgram(host);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true;
    watcher.close();
    child?.kill();
  });
