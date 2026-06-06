import type { CheckModule } from '../types.js';

import llmsTxt, { meta as llmsTxtMeta } from './llms-txt.js';
import robotsTxt, { meta as robotsTxtMeta } from './robots-txt.js';
import agentJson, { meta as agentJsonMeta } from './agent-json.js';
import securityTxt, { meta as securityTxtMeta } from './security-txt.js';
import structuredData, { meta as structuredDataMeta } from './structured-data.js';
import metaTags, { meta as metaTagsMeta } from './meta-tags.js';
import openapi, { meta as openapiMeta } from './openapi.js';
import httpHeaders, { meta as httpHeadersMeta } from './http-headers.js';
import mcp, { meta as mcpMeta } from './mcp.js';
import htmlRendering, { meta as htmlRenderingMeta } from './html-rendering.js';
import sitemap, { meta as sitemapMeta } from './sitemap.js';
import seoBasics, { meta as seoBasicsMeta } from './seo-basics.js';
import tlsHttps, { meta as tlsHttpsMeta } from './tls-https.js';
import wellKnownAi, { meta as wellKnownAiMeta } from './well-known-ai.js';
import contentNegotiation, { meta as contentNegotiationMeta } from './content-negotiation.js';
import rsl, { meta as rslMeta } from './rsl.js';

export const checks: CheckModule[] = [
  { run: llmsTxt, meta: llmsTxtMeta },
  { run: robotsTxt, meta: robotsTxtMeta },
  { run: agentJson, meta: agentJsonMeta },
  { run: securityTxt, meta: securityTxtMeta },
  { run: structuredData, meta: structuredDataMeta },
  { run: metaTags, meta: metaTagsMeta },
  { run: openapi, meta: openapiMeta },
  { run: httpHeaders, meta: httpHeadersMeta },
  { run: mcp, meta: mcpMeta },
  { run: htmlRendering, meta: htmlRenderingMeta },
  { run: sitemap, meta: sitemapMeta },
  { run: seoBasics, meta: seoBasicsMeta },
  { run: tlsHttps, meta: tlsHttpsMeta },
  { run: wellKnownAi, meta: wellKnownAiMeta },
  { run: contentNegotiation, meta: contentNegotiationMeta },
  { run: rsl, meta: rslMeta },
];
