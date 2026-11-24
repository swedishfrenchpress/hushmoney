// Checks the TypeScript compiler doesn't: run by `npm run lint`, after `tsc`.
//   - no console.log or debugger left in the app (console.error and warn are fine)
//   - no .only left in a test
//   - no em dashes in anything a visitor sees

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir) =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });

const rules = [
  { files: [...walk('src'), ...walk('server'), ...walk('shared')], bad: /\bconsole\.log\(|\bdebugger\b/, why: 'console.log or debugger in the app' },
  { files: walk('tests'), bad: /\b(test|describe|it)\.only\(/, why: '.only left in a test' },
  { files: [...walk('src'), 'index.html', 'listen/index.html', 'how/index.html', 'music/index.html'], bad: /—/, why: 'an em dash in visitor-facing copy' },
];

let problems = 0;
for (const { files, bad, why } of rules) {
  for (const file of files) {
    readFileSync(join(root, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (bad.test(line)) {
          problems++;
          console.log(`${relative(root, join(root, file))}:${i + 1}: ${why}\n    ${line.trim().slice(0, 120)}`);
        }
      });
  }
}
if (problems) {
  console.log(`\n${problems} problem${problems === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('lint: clean');
