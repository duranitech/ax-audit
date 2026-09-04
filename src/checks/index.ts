import type { CheckModule } from '../types.js';

import llmsTxt, { meta as llmsTxtMeta } from './llms-txt.js';
import robotsTxt, { meta as robotsTxtMeta } from './robots-txt.js';
import agentCard, { meta as agentCardMeta } from './agent-card.js';
import securityTxt, { meta as securityTxtMeta } from './security-txt.js';
import structuredData, { meta as structuredDataMeta } from './structured-data.js';
import metaTags, { meta as metaTagsMeta } from './meta-tags.js';
import apiDiscovery, { meta as apiDiscoveryMeta } from './api-discovery.js';
import httpHeaders, { meta as httpHeadersMeta } from './http-headers.js';
import mcpDiscovery, { meta as mcpDiscoveryMeta } from './mcp-discovery.js';
import htmlRendering, { meta as htmlRenderingMeta } from './html-rendering.js';
import sitemap, { meta as sitemapMeta } from './sitemap.js';
import seoBasics, { meta as seoBasicsMeta } from './seo-basics.js';
import tlsHttps, { meta as tlsHttpsMeta } from './tls-https.js';
import wellKnownAi, { meta as wellKnownAiMeta } from './well-known-ai.js';
import contentNegotiation, { meta as contentNegotiationMeta } from './content-negotiation.js';
import rsl, { meta as rslMeta } from './rsl.js';
import agentAccess, { meta as agentAccessMeta } from './agent-access.js';
import crawlEfficiency, { meta as crawlEfficiencyMeta } from './crawl-efficiency.js';
import aiDirectives, { meta as aiDirectivesMeta } from './ai-directives.js';

export const checks: CheckModule[] = [
  { run: llmsTxt, meta: llmsTxtMeta },
  { run: robotsTxt, meta: robotsTxtMeta },
  { run: agentCard, meta: agentCardMeta },
  { run: securityTxt, meta: securityTxtMeta },
  { run: structuredData, meta: structuredDataMeta },
  { run: metaTags, meta: metaTagsMeta },
  { run: apiDiscovery, meta: apiDiscoveryMeta },
  { run: httpHeaders, meta: httpHeadersMeta },
  { run: mcpDiscovery, meta: mcpDiscoveryMeta },
  { run: htmlRendering, meta: htmlRenderingMeta },
  { run: sitemap, meta: sitemapMeta },
  { run: seoBasics, meta: seoBasicsMeta },
  { run: tlsHttps, meta: tlsHttpsMeta },
  { run: wellKnownAi, meta: wellKnownAiMeta },
  { run: contentNegotiation, meta: contentNegotiationMeta },
  { run: rsl, meta: rslMeta },
  { run: agentAccess, meta: agentAccessMeta },
  { run: crawlEfficiency, meta: crawlEfficiencyMeta },
  { run: aiDirectives, meta: aiDirectivesMeta },
];
