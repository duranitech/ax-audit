import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Grade, SecurityHeader } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

export const VERSION: string = pkg.version;
export const USER_AGENT = `ax-audit/${pkg.version} (https://github.com/lucioduran/ax-audit)`;

/**
 * Known AI / LLM crawlers grouped by primary purpose. The audit recommends explicit
 * `User-agent:` rules for every entry so site operators can see exactly which agents
 * have access. Buckets:
 *
 * - `training`   — bots that scrape content for model training corpora
 * - `search`     — bots that fetch on behalf of a live answer engine / search UI
 * - `fetching`   — generic on-demand fetchers (browsing, summarization, automation)
 */
export const AI_CRAWLERS: Record<string, string[]> = {
  training: [
    'GPTBot',
    'ClaudeBot',
    'Claude-Web',
    'Anthropic-AI',
    'Google-Extended',
    'CCBot',
    'Bytespider',
    'Meta-ExternalAgent',
    'Meta-ExternalFetcher',
    'Cohere-AI',
    'cohere-training-data-crawler',
    'Applebot-Extended',
    'Amazonbot',
    'AI2Bot',
    'AI2Bot-Dolma',
    'DeepSeek-AI',
    'PanguBot',
    'Diffbot',
    'MistralAI-User',
    'Kangaroo Bot',
    'Timpibot',
    'omgili',
    'omgilibot',
    'ImagesiftBot',
    'Webzio-Extended',
  ],
  search: [
    'OAI-SearchBot',
    'ChatGPT-User',
    'Claude-SearchBot',
    'Claude-User',
    'PerplexityBot',
    'Perplexity-User',
    'DuckAssistBot',
    'YouBot',
    'Petalbot',
    'Google-CloudVertexBot',
    'Gemini',
    'GeminiBot',
    'KagiBot',
    'NeevaBot',
    'PhindBot',
  ],
  fetching: ['FirecrawlAgent', 'Facebookbot', 'Bingbot', 'Goose', 'AwarioBot', 'AwarioRssBot', 'AwarioSmartBot'],
};

export const ALL_AI_CRAWLERS: string[] = [...AI_CRAWLERS.training, ...AI_CRAWLERS.search, ...AI_CRAWLERS.fetching];

/**
 * The "must-configure" subset — these are the agents a typical operator should grant
 * (or knowingly deny) explicit access to. ax-audit grades the robots.txt section heavily
 * on coverage of this short list, while still rewarding broader explicit rules.
 */
export const CORE_AI_CRAWLERS: string[] = [
  'GPTBot',
  'ClaudeBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Google-Extended',
  'PerplexityBot',
  'OAI-SearchBot',
  'CCBot',
];

/**
 * Default weight per check (sum: 100). Individual `CheckMeta.weight` overrides this map.
 * Keep weights aligned with real-world impact — discovery + content-rendering are the
 * highest-leverage signals for AI agents.
 */
export const CHECK_WEIGHTS: Record<string, number> = {
  'llms-txt': 11,
  'robots-txt': 11,
  'html-rendering': 9,
  'structured-data': 9,
  'http-headers': 9,
  'agent-json': 7,
  mcp: 7,
  'seo-basics': 7,
  'security-txt': 6,
  'meta-tags': 6,
  openapi: 6,
  'tls-https': 5,
  sitemap: 4,
  'well-known-ai': 3,
  // Informational in 3.x: reported but does not affect the overall score.
  // Will gain weight in v4.0 — score-affecting changes are treated as breaking (see CHANGELOG 3.0.0).
  'content-negotiation': 0,
};

export const GRADES: Grade[] = [
  { min: 90, label: 'Excellent', color: 'green' },
  { min: 70, label: 'Good', color: 'yellow' },
  { min: 50, label: 'Fair', color: 'orange' },
  { min: 0, label: 'Poor', color: 'red' },
];

/**
 * Content Signals Policy vocabulary (https://contentsignals.org, CC0): machine-readable
 * `Content-Signal:` robots.txt directives expressing how content may be used after access.
 * Absence of a signal is neutral — it neither grants nor restricts.
 */
export const CONTENT_SIGNALS: string[] = ['search', 'ai-input', 'ai-train'];

export const AGENT_JSON_REQUIRED_FIELDS: string[] = ['name', 'description', 'url', 'skills'];

export const SECURITY_TXT_REQUIRED_FIELDS: string[] = ['Contact', 'Expires'];

export const SECURITY_HEADERS: SecurityHeader[] = [
  { name: 'strict-transport-security', label: 'Strict-Transport-Security', critical: true },
  { name: 'x-content-type-options', label: 'X-Content-Type-Options', critical: true },
  { name: 'x-frame-options', label: 'X-Frame-Options', critical: false },
  { name: 'x-xss-protection', label: 'X-XSS-Protection', critical: false },
  { name: 'referrer-policy', label: 'Referrer-Policy', critical: false },
  { name: 'permissions-policy', label: 'Permissions-Policy', critical: false },
  { name: 'content-security-policy', label: 'Content-Security-Policy', critical: false },
];
