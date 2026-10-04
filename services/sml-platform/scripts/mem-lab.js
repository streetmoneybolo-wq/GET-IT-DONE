#!/usr/bin/env node
'use strict';
/* usage: node scripts/mem-lab.js <csv-dir> [--store file.json] [--budget 48] [--approve] [--report] */
const { createMemLab, csvDirSource, fileStore } = require('../platform/academy-mem-lab-service.js');
const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const dir = a.find((x) => !x.startsWith('--') && a[a.indexOf(x) - 1] !== '--store' && a[a.indexOf(x) - 1] !== '--budget');
const labSvc = createMemLab({ sources: dir ? [csvDirSource(dir)] : [], store: fileStore(opt('--store', 'mem-lab-state.json')), budget: +opt('--budget', 48), log: (...x) => console.log(...x) });
(async () => {
  if (a.includes('--approve')) console.log(JSON.stringify(await labSvc.approve(), null, 1));
  else if (a.includes('--report') || !dir) console.log(JSON.stringify(await labSvc.report(), null, 1));
  else console.log(JSON.stringify(await labSvc.cycle(), null, 1));
})();
