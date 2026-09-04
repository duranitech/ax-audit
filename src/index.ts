export { audit, batchAudit } from './orchestrator.js';
export { calculateOverallScore, getGrade } from './scorer.js';
export { checks } from './checks/index.js';
export { saveBaseline, loadBaseline, diffBaseline, toBaselineData } from './baseline.js';
export { renderMarkdown, renderBatchMarkdown } from './reporter/markdown.js';
export { renderHtml, renderBatchHtml } from './reporter/html.js';

/**
 * The reference data a consumer needs to *describe* an audit rather than
 * only run one.
 *
 * A report that prints what a check is worth, a page that groups results
 * by area, a robots.txt editor that names the crawlers worth naming —
 * each of those needs a table this package already keeps, and none of
 * them should keep a second copy of it. Before 4.1 there was no way to
 * reach these: the `exports` map admits only this entry point, so every
 * consumer transcribed the tables by hand and wrote a test to catch the
 * day they went stale.
 *
 * Exported deliberately and by name. The rest of `constants.ts` is
 * implementation — thresholds, media types, required-field lists — and
 * stays private, because a consumer pinned to those would make every
 * check's internals a breaking change.
 */
export {
  VERSION,
  CHECK_WEIGHTS,
  CHECK_CATEGORIES,
  AI_CRAWLERS,
  ALL_AI_CRAWLERS,
  CORE_AI_CRAWLERS,
  LEGACY_AI_CRAWLERS,
  CRAWLER_META,
  crawlerInfo,
  crawlerPurpose,
  legacyCrawlerNote,
  CONTENT_SIGNALS,
  GRADES,
} from './constants.js';

export type { CrawlerInfo, CrawlerPurpose } from './constants.js';

export type {
  AuditOptions,
  AuditReport,
  BaselineData,
  BaselineDiff,
  BatchAuditReport,
  BatchOptions,
  CheckCategory,
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
