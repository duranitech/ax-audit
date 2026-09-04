import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CheckCategory, Grade, SecurityHeader } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

export const VERSION: string = pkg.version;
export const USER_AGENT = `ax-audit/${pkg.version} (https://github.com/lucioduran/ax-audit)`;

/**
 * What an AI client does with a page, and therefore what a site loses by
 * blocking it. This distinction is the single most important thing an audit can
 * tell an operator: blocking a training crawler is a policy choice, while
 * blocking a search crawler removes the site from that assistant's answers.
 *
 * - `training`   — builds model training corpora.
 * - `search`     — builds the index a live assistant cites from.
 * - `user-fetch` — retrieves one URL because a human asked for it, right now.
 * - `agent`      — an autonomous browser acting on a user's behalf.
 */
export type CrawlerPurpose = 'training' | 'search' | 'user-fetch' | 'agent';

export interface CrawlerInfo {
  vendor: string;
  purpose: CrawlerPurpose;
  /**
   * Whether the vendor documents that this client obeys robots.txt.
   * `partial` covers clients documented as "may not apply" — chiefly
   * user-triggered fetchers, which most vendors exempt.
   */
  honorsRobots: boolean | 'partial';
  /** One sentence on what blocking this client costs. Surfaced directly in findings. */
  impact: string;
  /** Vendor documentation for the token. */
  docUrl: string;
  /** Published IP-range list, where the vendor offers one for reverse verification. */
  ipListUrl?: string;
  /** Vendor signs requests with Web Bot Auth (RFC 9421 HTTP Message Signatures). */
  signsRequests?: boolean;
  /**
   * A robots.txt control token that never appears in a request. `Google-Extended`
   * and `Applebot-Extended` govern how an already-crawled page may be used; no
   * user agent carries these strings, so probing a site with them tests nothing.
   */
  tokenOnly?: boolean;
  /** Extra context: renames, documentation changes, unusual behaviour. */
  note?: string;
}

/**
 * Per-token metadata for the crawlers worth explaining. Tokens in
 * `AI_CRAWLERS` without an entry here are recognised for matching but carry no
 * tailored advice — the long tail of data brokers and regional assistants.
 *
 * Every entry was verified against vendor documentation on 2026-09-04.
 */
export const CRAWLER_META: Record<string, CrawlerInfo> = {
  GPTBot: {
    vendor: 'OpenAI',
    purpose: 'training',
    honorsRobots: true,
    impact: 'Blocking it keeps your content out of OpenAI model training. It does not affect ChatGPT search citations.',
    docUrl: 'https://developers.openai.com/api/docs/bots',
    ipListUrl: 'https://openai.com/gptbot.json',
  },
  'OAI-SearchBot': {
    vendor: 'OpenAI',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Blocking it removes your site from ChatGPT search answers and citations.',
    docUrl: 'https://developers.openai.com/api/docs/bots',
    ipListUrl: 'https://openai.com/searchbot.json',
    note: 'OpenAI removed the "also used for training" language from this bot in December 2025.',
  },
  'ChatGPT-User': {
    vendor: 'OpenAI',
    purpose: 'user-fetch',
    honorsRobots: 'partial',
    impact:
      'Fetches a page because a ChatGPT user asked for that URL. Blocking it breaks link-following in conversations.',
    docUrl: 'https://developers.openai.com/api/docs/bots',
    ipListUrl: 'https://openai.com/chatgpt-user.json',
    note: 'Since December 2025 OpenAI documents that robots.txt rules may not apply to this user-triggered fetcher.',
  },
  'OAI-AdsBot': {
    vendor: 'OpenAI',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Validates landing pages for ChatGPT ads. No training use.',
    docUrl: 'https://developers.openai.com/api/docs/bots',
    ipListUrl: 'https://openai.com/adsbot.json',
    note: 'Introduced April 2026.',
  },
  ClaudeBot: {
    vendor: 'Anthropic',
    purpose: 'training',
    honorsRobots: true,
    impact: 'Blocking it keeps your content out of Claude model training.',
    docUrl: 'https://support.claude.com/en/articles/8896518',
    ipListUrl: 'https://claude.com/crawling/bots.json',
  },
  'Claude-SearchBot': {
    vendor: 'Anthropic',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Blocking it removes your site from the index Claude cites when it searches the web.',
    docUrl: 'https://support.claude.com/en/articles/8896518',
    ipListUrl: 'https://claude.com/crawling/bots.json',
  },
  'Claude-User': {
    vendor: 'Anthropic',
    purpose: 'user-fetch',
    honorsRobots: true,
    impact:
      'Fetches a page because a Claude user asked for that URL. Blocking it breaks link-following in conversations.',
    docUrl: 'https://support.claude.com/en/articles/8896518',
    ipListUrl: 'https://claude.com/crawling/bots.json',
    note: 'Unusual among user-triggered fetchers: Anthropic documents that it does obey robots.txt.',
  },
  'Google-Extended': {
    vendor: 'Google',
    purpose: 'training',
    honorsRobots: true,
    impact:
      'Controls Gemini training and grounding in Gemini Apps and Vertex AI. It does NOT remove your site from AI Overviews or AI Mode, which follow Googlebot and the snippet directives.',
    docUrl: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers',
    tokenOnly: true,
    note: 'A robots.txt token, not a crawler: no request ever carries this user agent.',
  },
  'Google-CloudVertexBot': {
    vendor: 'Google',
    purpose: 'training',
    honorsRobots: true,
    impact: 'Crawls sites at their owner\u2019s request to build Vertex AI Agents. Site-owner initiated.',
    docUrl: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers',
    ipListUrl: 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
  },
  'Google-Agent': {
    vendor: 'Google',
    purpose: 'agent',
    honorsRobots: false,
    impact:
      'Google\u2019s user-triggered browsing agent. It generally ignores robots.txt, so rules for it are advisory.',
    docUrl: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent',
    ipListUrl: 'https://developers.google.com/static/search/apis/ipranges/user-triggered-agents.json',
    signsRequests: true,
    note: 'Introduced 2026-03-20, superseding Project Mariner. Web Bot Auth identity https://agent.bot.goog (experimental; not every request is signed).',
  },
  'Google-GeminiNotebook': {
    vendor: 'Google',
    purpose: 'user-fetch',
    honorsRobots: false,
    impact: 'Fetches sources a user added to Gemini Notebook. Ignores robots.txt.',
    docUrl: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers',
    note: 'Renamed from Google-NotebookLM on 2026-07-17; the old token was supported until August 2026.',
  },
  bingbot: {
    vendor: 'Microsoft',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Blocking it removes your site from Bing and from the index Copilot grounds its answers in.',
    docUrl: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0',
    ipListUrl: 'https://www.bing.com/toolbox/bingbot.json',
    note: 'Multi-purpose: page-level noarchive / nocache directives control the Copilot generative use separately.',
  },
  'Meta-ExternalAgent': {
    vendor: 'Meta',
    purpose: 'training',
    honorsRobots: true,
    impact: 'Blocking it keeps your content out of Meta AI training and indexing.',
    docUrl: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/',
    note: 'Second-largest AI crawler by request share in mid-2026.',
  },
  'meta-webindexer': {
    vendor: 'Meta',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Blocking it removes your site from Meta AI search results and citations.',
    docUrl: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/',
    note: 'Newer than the widely copied robots.txt templates, so most sites have no rule for it.',
  },
  'meta-externalfetcher': {
    vendor: 'Meta',
    purpose: 'user-fetch',
    honorsRobots: 'partial',
    impact: 'Fetches a page for a user request or agentic task. Meta documents that it may bypass robots.txt.',
    docUrl: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/',
  },
  Applebot: {
    vendor: 'Apple',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Powers Siri and Spotlight results, and since June 2026 also feeds Apple Intelligence answers.',
    docUrl: 'https://support.apple.com/en-us/119829',
    ipListUrl: 'https://search.developer.apple.com/applebot.json',
    note: 'Falls back to Googlebot rules when no Applebot group exists.',
  },
  'Applebot-Extended': {
    vendor: 'Apple',
    purpose: 'training',
    honorsRobots: true,
    impact: 'Opts your content out of Apple foundation-model training without affecting Siri or Spotlight.',
    docUrl: 'https://support.apple.com/en-us/119829',
    tokenOnly: true,
    note: 'A robots.txt token, not a crawler.',
  },
  Amazonbot: {
    vendor: 'Amazon',
    purpose: 'training',
    honorsRobots: true,
    impact: 'General crawler whose content may be used to train Amazon AI models.',
    docUrl: 'https://developer.amazon.com/amazonbot',
    ipListUrl: 'https://developer.amazon.com/amazonbot/ip-addresses/',
    note: 'Managed through robots.txt only since 2026-06-15.',
  },
  'Amzn-SearchBot': {
    vendor: 'Amazon',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Blocking it removes your site from Alexa and Rufus answers. No training use.',
    docUrl: 'https://developer.amazon.com/amazonbot',
  },
  'Amzn-User': {
    vendor: 'Amazon',
    purpose: 'user-fetch',
    honorsRobots: 'partial',
    impact: 'Fetches a page for a live Amazon assistant request. No training use.',
    docUrl: 'https://developer.amazon.com/amazonbot',
  },
  PerplexityBot: {
    vendor: 'Perplexity',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Blocking it removes your site from Perplexity answers and citations. Not used for model training.',
    docUrl: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers',
    ipListUrl: 'https://www.perplexity.com/perplexitybot.json',
  },
  'Perplexity-User': {
    vendor: 'Perplexity',
    purpose: 'user-fetch',
    honorsRobots: false,
    impact: 'Fetches a page a Perplexity user opened. Perplexity documents that it generally ignores robots.txt.',
    docUrl: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers',
    ipListUrl: 'https://www.perplexity.com/perplexity-user.json',
  },
  CCBot: {
    vendor: 'Common Crawl',
    purpose: 'training',
    honorsRobots: true,
    impact:
      'Builds the open Common Crawl corpus that many models train on. Blocking it is the single broadest training opt-out.',
    docUrl: 'https://commoncrawl.org/ccbot',
    ipListUrl: 'https://index.commoncrawl.org/ccbot.json',
  },
  Bytespider: {
    vendor: 'ByteDance',
    purpose: 'training',
    honorsRobots: 'partial',
    impact: 'Collects training data for ByteDance models. Compliance with robots.txt is disputed.',
    docUrl: 'https://zhanzhang.toutiao.com/',
  },
  'MistralAI-User': {
    vendor: 'Mistral',
    purpose: 'user-fetch',
    honorsRobots: true,
    impact: 'Fetches a page for a Le Chat user request.',
    docUrl: 'https://docs.mistral.ai/robots/',
    ipListUrl: 'https://mistral.ai/mistralai-user-ips.json',
  },
  'MistralAI-Index': {
    vendor: 'Mistral',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Blocking it removes your site from Le Chat search results. No training use.',
    docUrl: 'https://docs.mistral.ai/robots/',
    ipListUrl: 'https://mistral.ai/mistralai-index-ips.json',
  },
  'MistralAI-Training': {
    vendor: 'Mistral',
    purpose: 'training',
    honorsRobots: true,
    impact: 'Collects training data for Mistral models.',
    docUrl: 'https://docs.mistral.ai/robots/',
  },
  DuckAssistBot: {
    vendor: 'DuckDuckGo',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Fetches pages in real time for DuckDuckGo AI answers. No training use.',
    docUrl: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot/',
    ipListUrl: 'https://duckduckgo.com/duckassistbot.json',
  },
  ExaSearchBot: {
    vendor: 'Exa',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Builds the Exa search index used by AI agents and retrieval pipelines.',
    docUrl: 'https://crawler.exa.ai/',
    signsRequests: true,
    note: 'Signs every request with Web Bot Auth, so an IP-verifying WAF can admit it precisely.',
  },
  Kagibot: {
    vendor: 'Kagi',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Blocking it removes your site from Kagi search and its Assistant answers.',
    docUrl: 'https://kagi.com/bot',
  },
  YouBot: {
    vendor: 'You.com',
    purpose: 'search',
    honorsRobots: true,
    impact: 'Indexes pages for You.com search and its LLM answers.',
    docUrl: 'https://about.you.com/youbot/',
    signsRequests: true,
  },
  AI2Bot: {
    vendor: 'Allen Institute for AI',
    purpose: 'training',
    honorsRobots: true,
    impact: 'Collects data for open research corpora (OLMo, Dolma).',
    docUrl: 'https://allenai.org/crawler',
  },
  FirecrawlAgent: {
    vendor: 'Firecrawl',
    purpose: 'agent',
    honorsRobots: true,
    impact: 'Scraping-as-a-service used by agent builders to read your pages on demand.',
    docUrl: 'https://docs.firecrawl.dev/',
  },
};

/**
 * Known AI clients grouped by what they do with a page. Matching is
 * case-insensitive, per RFC 9309 §2.2.1, so the casing here is cosmetic and
 * follows each vendor's own documentation.
 *
 * Verified against vendor documentation on 2026-09-04. Tokens that turned out
 * never to have existed (`Gemini`, `GeminiBot`, `DeepSeek-AI`) or to belong to
 * discontinued products (`NeevaBot`, `GoogleAgent-Mariner`) moved to
 * `LEGACY_AI_CRAWLERS`.
 */
export const AI_CRAWLERS: Record<CrawlerPurpose, string[]> = {
  training: [
    'GPTBot',
    'ClaudeBot',
    'Meta-ExternalAgent',
    'Google-Extended',
    'Applebot-Extended',
    'Amazonbot',
    'CCBot',
    'Bytespider',
    'TikTokSpider',
    'MistralAI-Training',
    'AI2Bot',
    'Ai2Bot-Dolma',
    'DeepSeekBot',
    'PanguBot',
    'Google-CloudVertexBot',
    'FacebookBot',
    'Timpibot',
    'Webzio-Extended',
    'omgili',
    'omgilibot',
    'ImagesiftBot',
    'Kangaroo Bot',
    'Diffbot',
    'YandexAdditional',
    'YandexAdditionalBot',
  ],
  search: [
    'OAI-SearchBot',
    'Claude-SearchBot',
    'PerplexityBot',
    'meta-webindexer',
    'Amzn-SearchBot',
    'MistralAI-Index',
    'Applebot',
    'bingbot',
    'DuckAssistBot',
    'YouBot',
    'Kagibot',
    'PetalBot',
    'ExaSearchBot',
    'PhindBot',
    'Yeti',
    'OAI-AdsBot',
  ],
  'user-fetch': [
    'ChatGPT-User',
    'Claude-User',
    'Perplexity-User',
    'MistralAI-User',
    'meta-externalfetcher',
    'Amzn-User',
    'Google-GeminiNotebook',
    'kagi-fetcher',
    'Kimi-User',
    'TongyiBot',
  ],
  agent: ['Google-Agent', 'NovaAct', 'Manus-User', 'Devin', 'FirecrawlAgent', 'TavilyBot'],
};

/**
 * Tokens recognised for matching but never recommended: renamed, retired, or
 * never real. A site that lists these is not wrong, but the rules are inert, so
 * the audit says so rather than counting them as coverage.
 */
export const LEGACY_AI_CRAWLERS: Record<string, string> = {
  'Claude-Web': 'Never documented by Anthropic and absent from its current crawler page. Use ClaudeBot.',
  'Anthropic-AI': 'Never documented by Anthropic. Use ClaudeBot.',
  'Google-NotebookLM': 'Renamed to Google-GeminiNotebook on 2026-07-17.',
  'GoogleAgent-Mariner': 'Project Mariner was discontinued on 2026-05-04; superseded by Google-Agent.',
  'Cohere-AI': 'Cohere states it operates no web crawlers.',
  'cohere-training-data-crawler': 'Cohere states it operates no web crawlers.',
  ExaBot: 'Superseded by ExaSearchBot.',
  NeevaBot: 'Neeva was dissolved in 2023.',
  Gemini: 'Not a real user-agent token. Gemini training and grounding are controlled by Google-Extended.',
  GeminiBot: 'Not a real user-agent token. Gemini training and grounding are controlled by Google-Extended.',
  'DeepSeek-AI': 'Not a documented token. The community-observed crawler identifies as DeepSeekBot.',
  Goose: 'Block Goose is an agent framework that signs requests with Web Bot Auth; it has no robots.txt token.',
  AwarioBot: 'Awario is a social-listening tool, not an AI crawler.',
  AwarioRssBot: 'Awario is a social-listening tool, not an AI crawler.',
  AwarioSmartBot: 'Awario is a social-listening tool, not an AI crawler.',
  Operator: 'OpenAI Operator was discontinued on 2025-08-31 and never had a documented robots.txt token.',
};

export const ALL_AI_CRAWLERS: string[] = [
  ...AI_CRAWLERS.training,
  ...AI_CRAWLERS.search,
  ...AI_CRAWLERS['user-fetch'],
  ...AI_CRAWLERS.agent,
];

/**
 * The crawlers that matter most as of September 2026, by request share
 * (Cloudflare Radar) and by what a site loses when each is blocked. Used for
 * reporting, access probes, and remediation advice.
 *
 * Composition: the six highest-volume clients (Googlebot's AI use is governed
 * by Google-Extended, Applebot's by Applebot-Extended, hence the opt-out tokens
 * standing in for them), the broadest training corpus (CCBot), the three search
 * bots whose absence costs citations, and the one user-triggered fetcher with
 * material volume.
 */
export const CORE_AI_CRAWLERS: string[] = [
  'GPTBot',
  'ClaudeBot',
  'Meta-ExternalAgent',
  'Google-Extended',
  'Applebot-Extended',
  'Amazonbot',
  'Bytespider',
  'CCBot',
  'OAI-SearchBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'ChatGPT-User',
];

/**
 * The 3.x scoring set, frozen at the eight tokens 3.0 shipped with.
 *
 * `robots-txt` deducts points for missing core crawlers, so widening the set
 * would lower every existing score — a breaking change under the 3.x policy
 * (see docs/architecture.md). The four additions in `CORE_AI_CRAWLERS` are
 * reported informationally until 4.0, when this constant is removed and
 * scoring moves to the full list.
 */
export const SCORED_CORE_CRAWLERS: string[] = [
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
 * Core crawlers that actually issue HTTP requests.
 *
 * `Google-Extended` and `Applebot-Extended` are robots.txt control tokens: they
 * govern how an already-crawled page may be used, and no request ever carries
 * them as a user agent. Probing a site with those strings tests nothing, so
 * access checks use this list instead of the full core set.
 */
export const PROBEABLE_CORE_CRAWLERS: string[] = CORE_AI_CRAWLERS.filter(
  (token) => CRAWLER_META[token]?.tokenOnly !== true,
);

/**
 * The AI-client tokens ax-audit 3.6 recognised, frozen for scoring stability.
 *
 * `robots-txt` deducts points for explicitly blocked AI crawlers. The 3.7
 * catalogue refresh added real tokens that 3.6 missed (`meta-webindexer`,
 * `Amzn-SearchBot`, `MistralAI-Index`, ...), and scoring against the new list
 * would lower the score of any site that already blocks them — a breaking
 * change under the 3.x policy (docs/architecture.md).
 *
 * So deductions are computed against this frozen list while the wider catalogue
 * drives reporting. Removed at 4.0, when weights are redistributed anyway.
 */
export const SCORED_KNOWN_CRAWLERS_V3: string[] = [
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
  'FirecrawlAgent',
  'Facebookbot',
  'Bingbot',
  'Goose',
  'AwarioBot',
  'AwarioRssBot',
  'AwarioSmartBot',
  'Google-Agent',
];

/** Look up a crawler's metadata case-insensitively. */
export function crawlerInfo(token: string): CrawlerInfo | undefined {
  const key = Object.keys(CRAWLER_META).find((k) => k.toLowerCase() === token.toLowerCase());
  return key === undefined ? undefined : CRAWLER_META[key];
}

/** Purpose bucket a token belongs to, or `undefined` when it is not a known AI client. */
export function crawlerPurpose(token: string): CrawlerPurpose | undefined {
  const lower = token.toLowerCase();
  for (const [purpose, tokens] of Object.entries(AI_CRAWLERS) as [CrawlerPurpose, string[]][]) {
    if (tokens.some((t) => t.toLowerCase() === lower)) return purpose;
  }
  return undefined;
}

/** Explanation for a retired or fictional token, or `undefined` when the token is current. */
export function legacyCrawlerNote(token: string): string | undefined {
  const key = Object.keys(LEGACY_AI_CRAWLERS).find((k) => k.toLowerCase() === token.toLowerCase());
  return key === undefined ? undefined : LEGACY_AI_CRAWLERS[key];
}

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
  'agent-card': 7,
  'mcp-discovery': 7,
  'seo-basics': 7,
  'security-txt': 6,
  'meta-tags': 6,
  'api-discovery': 6,
  'tls-https': 5,
  sitemap: 4,
  'well-known-ai': 3,
  // Informational in 3.x: reported but does not affect the overall score.
  // Will gain weight in v4.0 — score-affecting changes are treated as breaking (see CHANGELOG 3.0.0).
  'content-negotiation': 0,
  rsl: 0,
  'agent-access': 0,
  'crawl-efficiency': 0,
  'ai-directives': 0,
  'usage-policy': 0,
};

/**
 * Report grouping per check. A check's own `meta.category` takes precedence.
 * Mirrors the `CHECK_WEIGHTS` pattern: data lives here, overrides live on the check.
 */
export const CHECK_CATEGORIES: Record<string, CheckCategory> = {
  'llms-txt': 'discovery',
  'robots-txt': 'discovery',
  'http-headers': 'discovery',
  'meta-tags': 'discovery',
  sitemap: 'discovery',
  'html-rendering': 'content',
  'structured-data': 'content',
  'seo-basics': 'content',
  'content-negotiation': 'content',
  'agent-access': 'access',
  'crawl-efficiency': 'access',
  'tls-https': 'access',
  rsl: 'policy',
  'security-txt': 'policy',
  'agent-card': 'protocols',
  'mcp-discovery': 'protocols',
  'api-discovery': 'protocols',
  'well-known-ai': 'protocols',
  'ai-directives': 'access',
  'usage-policy': 'policy',
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

/**
 * Values of the optional fourth Content Signals field `use`, introduced by
 * Cloudflare on 2026-07-01 and now emitted by its managed robots.txt:
 * `immediate` (interact, store nothing), `reference` (index, excerpt, link
 * back — the stated default) and `full` (summarize and reproduce).
 * https://blog.cloudflare.com/content-independence-day-ai-options/
 */
export const CONTENT_SIGNAL_USE_VALUES: string[] = ['immediate', 'reference', 'full'];

/**
 * IETF AIPREF vocabulary (draft-ietf-aipref-vocab-07, 2026-08-19). Two
 * categories only: `train-ai` (modifying model parameters) and `search`
 * (retrieval that links back to the original). Values are `y` / `n`; an absent
 * token means "unknown", never "allowed".
 *
 * The drafts are pre-working-group-last-call and carry the "DO NOT REFLECT
 * CONSENSUS" boilerplate, so ax-audit reports these directives without ever
 * requiring them. Note the token order is inverted against Content Signals
 * (`train-ai` here, `ai-train` there).
 * https://datatracker.ietf.org/wg/aipref/documents/
 */
export const AIPREF_TOKENS: string[] = ['train-ai', 'search'];
export const AIPREF_VALUES: string[] = ['y', 'n'];

/**
 * Really Simple Licensing 1.0 (https://rslstandard.org/rsl): machine-readable licensing
 * terms for content, discovered via robots.txt `License:`, HTTP `Link: rel="license"`,
 * or `<link rel="license" type="application/rsl+xml">`.
 */
export const RSL_NAMESPACE = 'https://rslstandard.org/rsl';
export const RSL_MIME = 'application/rsl+xml';
export const RSL_PERMIT_TYPES: string[] = ['usage', 'user', 'geo'];
export const RSL_USAGE_TOKENS: string[] = ['all', 'ai-all', 'ai-train', 'ai-input', 'ai-index', 'search'];
export const RSL_USER_TOKENS: string[] = ['commercial', 'non-commercial', 'education', 'government', 'personal'];
export const RSL_PAYMENT_TYPES: string[] = [
  'purchase',
  'subscription',
  'training',
  'crawl',
  'use',
  'contribution',
  'attribution',
  'free',
];

/**
 * A2A Agent Card (https://a2a-protocol.org).
 *
 * Two generations are in the wild. A2A 1.0 (2026-03-12) replaced the top-level
 * `url`, `protocolVersion`, `preferredTransport` and `additionalInterfaces`
 * fields with one `supportedInterfaces[]` array; 0.3-shaped cards are still the
 * majority deployed. Required-field lists are taken from `specification/a2a.proto`
 * (1.0) and `specification/json/a2a.json` at tag v0.3.0.
 */
export const AGENT_CARD_REQUIRED_V1: string[] = [
  'name',
  'description',
  'version',
  'capabilities',
  'supportedInterfaces',
  'defaultInputModes',
  'defaultOutputModes',
  'skills',
];

export const AGENT_CARD_REQUIRED_V03: string[] = [
  'name',
  'description',
  'url',
  'version',
  'protocolVersion',
  'capabilities',
  'defaultInputModes',
  'defaultOutputModes',
  'skills',
];

/** Transport bindings a 1.0 interface may declare. */
export const A2A_PROTOCOL_BINDINGS: string[] = ['JSONRPC', 'GRPC', 'HTTP+JSON'];

/** Media type registered for A2A payloads (spec §14.1.1). */
export const A2A_MEDIA_TYPE = 'application/a2a+json';

/** @deprecated Superseded by AGENT_CARD_REQUIRED_V03 / _V1 in 3.7. Kept for one minor. */
export const AGENT_JSON_REQUIRED_FIELDS: string[] = ['name', 'description', 'url', 'skills'];

/**
 * Model Context Protocol.
 *
 * `/.well-known/mcp.json` was never part of the specification; ax-audit
 * recommended it before the ecosystem settled. The actual discovery work is
 * SEP-2127 (open draft) and the `experimental-ext-server-card` repository,
 * which recommend a **server card** at `<streamable-http-url>/server-card` and
 * an entry in `/.well-known/ai-catalog.json`. Cloudflare and Mintlify serve one
 * at `/.well-known/mcp/server-card.json`.
 *
 * Server cards deliberately carry no `tools[]`: tool lists come from a live
 * `tools/list` call, not from a static document that would immediately drift.
 */
export const MCP_SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';
export const MCP_SERVER_CARD_REQUIRED: string[] = ['$schema', 'name', 'version', 'description'];
export const MCP_REMOTE_TYPES: string[] = ['streamable-http', 'sse'];

/**
 * Released MCP protocol versions, newest first. `2026-07-28` removed sessions
 * and `initialize`, made `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`
 * mandatory on every POST, and added the `server/discover` RPC.
 * https://modelcontextprotocol.io/specification/versioning
 */
export const MCP_PROTOCOL_VERSIONS: string[] = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** Versions old enough that a card advertising only these is worth flagging. */
export const MCP_STALE_PROTOCOL_VERSIONS: string[] = ['2024-11-05', '2025-03-26'];

/** Media types an ai-catalog entry may declare, per the Agent Card WG draft. */
export const AI_CATALOG_ENTRY_TYPES: Record<string, string> = {
  'application/mcp-server-card+json': 'MCP server card',
  'application/a2a-agent-card+json': 'A2A agent card',
  'application/ai-catalog+json': 'nested AI catalog',
};

/**
 * Where API descriptions live, in order of authority.
 *
 * `/.well-known/openapi.json` is a folk convention: it is not IANA-registered,
 * and the OpenAPI specification recommends the file name `openapi.json` /
 * `openapi.yaml` without prescribing a location. It stays first because
 * ax-audit recommended it before 3.7 and sites followed that advice, but the
 * common real-world locations are probed too.
 */
export const API_DESCRIPTION_PATHS: string[] = [
  '/.well-known/openapi.json',
  '/openapi.json',
  '/openapi.yaml',
  '/.well-known/openapi.yaml',
  '/api/openapi.json',
  '/v1/openapi.json',
  '/swagger.json',
  '/api-docs',
  '/asyncapi.json',
  '/arazzo.json',
];

/** RFC 9264 linkset media type, required by RFC 9727 for the API catalog. */
export const LINKSET_MEDIA_TYPE = 'application/linkset+json';

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
