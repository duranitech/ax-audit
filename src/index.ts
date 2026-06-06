export { audit, batchAudit } from './orchestrator.js';
export { calculateOverallScore, getGrade } from './scorer.js';
export { checks } from './checks/index.js';
export { saveBaseline, loadBaseline, diffBaseline, toBaselineData } from './baseline.js';

export type {
  AuditOptions,
  AuditReport,
  BaselineData,
  BaselineDiff,
  BatchAuditReport,
  CheckDiff,
  CheckResult,
  CheckMeta,
  CheckContext,
  CheckModule,
  Finding,
  FindingStatus,
  FetchOptions,
  FetchResponse,
  Grade,
  OutputFormat,
} from './types.js';
