import { reportTerminal, reportBatchTerminal } from './terminal.js';
import { reportJson, reportBatchJson } from './json.js';
import { reportHtml, reportBatchHtml } from './html.js';
import { reportMarkdown, reportBatchMarkdown } from './markdown.js';
import type { AuditReport, BaselineDiff, BatchAuditReport, OutputFormat } from '../types.js';

export function report(auditReport: AuditReport, format: OutputFormat, diff?: BaselineDiff): void {
  switch (format) {
    case 'json':
      reportJson(auditReport, diff);
      break;
    case 'html':
      reportHtml(auditReport, diff);
      break;
    case 'markdown':
      reportMarkdown(auditReport, diff);
      break;
    case 'terminal':
      reportTerminal(auditReport, diff);
      break;
  }
}

export function reportBatch(batchReport: BatchAuditReport, format: OutputFormat): void {
  switch (format) {
    case 'json':
      reportBatchJson(batchReport);
      break;
    case 'html':
      reportBatchHtml(batchReport);
      break;
    case 'markdown':
      reportBatchMarkdown(batchReport);
      break;
    case 'terminal':
      reportBatchTerminal(batchReport);
      break;
  }
}
