// tests/issue-group3-manifest-shape.test.mjs — P10 (code check).
//
// modes/pdf/hm-audit.md documents a 5-column manifest; the writer emits 6.
// Confirm the code shape is stable and self-describing, and that inferring a
// report number from a filename requires the -{report}- segment so a fallback
// cannot silently resolve a role-agnostic CV (e.g. output/cv.pdf).
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { applyManifestRow, inferReportNumber } from '../generate-pdf.mjs';

console.log('\nPDF manifest shape and report-numbered artifact paths (P10)');

const row = (over = {}) => ({
  reportNum: '042', pdf: 'output/cv-ana-042-acme-2026-11-20.pdf',
  html: 'output/cv-ana-042-acme-2026-11-20.html', format: 'a4', date: '2026-11-20', ...over,
});

{
  const lines = applyManifestRow([], row());
  const fields = lines[0].split('\t');
  if (fields.length === 6 && fields[0] === '042' && fields[1].includes('042-acme')
      && fields[5] === 'cv') {
    pass('P10: manifest data row has 6 self-describing columns incl. report # and role/company path');
  } else {
    fail(`P10 manifest shape: ${JSON.stringify(fields)}`);
  }
}
{
  // The writer's header comment names every column, so a reader cannot mistake
  // the 6-column output for a 5-column format. applyManifestRow() filters
  // comments when it writes, so check the source the writer actually uses.
  const source = readFileSync(join(ROOT, 'generate-pdf.mjs'), 'utf-8');
  const header = source.match(/# report\\tpdf\\thtml\\tformat\\tdate\\tkind[^\n]*/)?.[0] ?? '';
  const names = ['report', 'pdf', 'html', 'format', 'date', 'kind'];
  if (names.every((name) => header.includes(name))) {
    pass('P10: manifest header names all 6 columns (report … kind)');
  } else {
    fail(`P10 manifest header: ${JSON.stringify(header)}`);
  }
}
{
  const withReport = inferReportNumber('output/cv-ana-042-acme-2026-11-20.pdf');
  if (withReport?.reportNum === '042') {
    pass('P10: -{report}- segment in the artifact name yields the report number');
  } else {
    fail(`P10 report inference: ${JSON.stringify(withReport)}`);
  }
  const generic = inferReportNumber('output/cv.pdf', 'output/cv.html');
  if (generic === null) {
    pass('P10: role-agnostic output/cv.pdf does NOT infer a report number');
  } else {
    fail(`P10 generic fallback must not infer a report: ${JSON.stringify(generic)}`);
  }
}
