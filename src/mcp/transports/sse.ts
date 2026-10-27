#!/usr/bin/env node
/**
 * Medical MCP Server - SSE (Server-Sent Events) Transport
 * Provides streaming HTTP transport for real-time medical analysis
 */

import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { MedicalAnalyzeTool } from '../tools/medical-analyze';
import { MedicalVerifyTool } from '../tools/medical-verify';
import { ProviderNotifyTool } from '../tools/provider-notify';
import { ConfidenceScoreTool } from '../tools/confidence-score';
import { CitationVerifyTool } from '../tools/citation-verify';
import { KnowledgeSearchTool } from '../tools/knowledge-search';

console.error('🚀 Starting Medical MCP Server (SSE transport)...');

const server = new FastMCP({
  name: 'medical-mcp-sse',
  version: '1.0.0',
});

// Initialize tools
const medicalAnalyze = new MedicalAnalyzeTool();
const medicalVerify = new MedicalVerifyTool();
const providerNotify = new ProviderNotifyTool();
const confidenceScore = new ConfidenceScoreTool();
const citationVerify = new CitationVerifyTool();
const knowledgeSearch = new KnowledgeSearchTool();

// Tool 1: Medical Analysis
server.addTool({
  name: 'medical_analyze',
  description: 'Analyze medical symptoms and conditions with anti-hallucination safeguards. Provides confidence scoring, citation verification, and emergency escalation.',
  parameters: z.object({
    symptoms: z.array(z.string()).describe('List of symptoms to analyze'),
    patientHistory: z.string().optional().describe('Relevant patient medical history'),
    vitalSigns: z.record(z.string(), z.number()).optional().describe('Vital signs (temperature, heartRate, systolicBP, oxygenSaturation, etc.)'),
    includeRecommendations: z.boolean().optional().default(true).describe('Include treatment recommendations'),
  }),
  execute: async (args) => {
    const result = await medicalAnalyze.execute(args);
    return result.content[0].type === 'json'
      ? JSON.stringify(result.content[0].json, null, 2)
      : result.content[0].text || '';
  },
});

// Tool 2: Medical Verification
server.addTool({
  name: 'medical_verify',
  description: 'Verify medical analysis quality and accuracy with comprehensive checks for confidence, citations, consistency, completeness, and safety.',
  parameters: z.object({
    analysisId: z.string().describe('Analysis ID to verify'),
    analysis: z.any().optional().describe('Medical analysis object to verify'),
    strictMode: z.boolean().optional().default(true).describe('Enable strict validation mode'),
  }),
  execute: async (args) => {
    const result = await medicalVerify.execute(args);
    return result.content[0].type === 'json'
      ? JSON.stringify(result.content[0].json, null, 2)
      : result.content[0].text || '';
  },
});

// Tool 3: Provider Notification
server.addTool({
  name: 'provider_notify',
  description: 'Notify healthcare providers about medical analyses requiring review. Supports multiple channels (email, SMS, pager, app) based on urgency.',
  parameters: z.object({
    analysisId: z.string().describe('Analysis ID to notify about'),
    analysis: z.any().optional().describe('Medical analysis object'),
    urgency: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Notification urgency level'),
    recipient: z.string().optional().describe('Provider email or phone number'),
    channel: z.enum(['email', 'sms', 'pager', 'app']).optional().describe('Notification channel'),
    message: z.string().optional().describe('Custom notification message'),
  }),
  execute: async (args) => {
    const result = await providerNotify.execute(args);
    return result.content[0].type === 'json'
      ? JSON.stringify(result.content[0].json, null, 2)
      : result.content[0].text || '';
  },
});

// Tool 4: Confidence Scoring
server.addTool({
  name: 'confidence_score',
  description: 'Calculate comprehensive confidence scores for medical analyses with component breakdown (diagnosis, treatment, prognosis) and quality metrics.',
  parameters: z.object({
    analysis: z.any().optional().describe('Medical analysis object to score'),
    detailedBreakdown: z.boolean().optional().default(false).describe('Include detailed component breakdown'),
  }),
  execute: async (args) => {
    const result = await confidenceScore.execute(args);
    return result.content[0].type === 'json'
      ? JSON.stringify(result.content[0].json, null, 2)
      : result.content[0].text || '';
  },
});

// Tool 5: Citation Verification
server.addTool({
  name: 'citation_verify',
  description: 'Verify medical citations against trusted sources (PubMed, Cochrane, NICE, etc.). Validates citation quality, relevance, and source reliability.',
  parameters: z.object({
    citations: z.array(z.any()).describe('Array of citation objects to verify'),
    strictMode: z.boolean().optional().default(true).describe('Enable strict validation mode'),
  }),
  execute: async (args) => {
    const result = await citationVerify.execute(args);
    return result.content[0].type === 'json'
      ? JSON.stringify(result.content[0].json, null, 2)
      : result.content[0].text || '';
  },
});

// Tool 6: Knowledge Search
server.addTool({
  name: 'knowledge_search',
  description: 'Search medical knowledge bases (PubMed, Cochrane, UpToDate, NICE) for relevant clinical information, guidelines, and research.',
  parameters: z.object({
    query: z.string().describe('Search query for medical knowledge'),
    filters: z.object({
      sourceTypes: z.array(z.string()).optional().describe('Filter by source types'),
      minRelevance: z.number().optional().describe('Minimum relevance score (0-1)'),
      dateRange: z.object({
        start: z.string().optional().describe('Start date (ISO format)'),
        end: z.string().optional().describe('End date (ISO format)'),
      }).optional(),
      specialties: z.array(z.string()).optional().describe('Filter by medical specialties'),
    }).optional(),
    maxResults: z.number().optional().default(10).describe('Maximum number of results'),
  }),
  execute: async (args) => {
    // Convert string dates to Date objects
    if (args.filters?.dateRange) {
      const dr = args.filters.dateRange;
      args.filters.dateRange = {
        start: dr.start ? new Date(dr.start) : undefined as any,
        end: dr.end ? new Date(dr.end) : undefined as any,
      };
    }

    const result = await knowledgeSearch.execute(args);
    return result.content[0].type === 'json'
      ? JSON.stringify(result.content[0].json, null, 2)
      : result.content[0].text || '';
  },
});

console.error('✅ Registered 6 medical tools successfully');
console.error('🌐 Starting HTTP/SSE transport...');

// Start server with SSE transport
const PORT = parseInt(process.env.MCP_PORT || '8080', 10);

server.start({
  transportType: 'httpStream',
  httpStream: {
    port: PORT,
  },
}).then(() => {
  console.error('✅ Medical MCP Server running!');
  console.error(`📡 HTTP endpoint: http://localhost:${PORT}/mcp`);
  console.error(`📡 SSE endpoint: http://localhost:${PORT}/sse`);
  console.error(`💊 Health check: http://localhost:${PORT}/health`);
  console.error('');
  console.error('🏥 Available Tools:');
  console.error('  • medical_analyze - Analyze medical conditions');
  console.error('  • medical_verify - Verify analysis quality');
  console.error('  • provider_notify - Notify healthcare providers');
  console.error('  • confidence_score - Calculate confidence scores');
  console.error('  • citation_verify - Verify citations');
  console.error('  • knowledge_search - Search medical knowledge');
}).catch((error) => {
  console.error('❌ Failed to start SSE server:', error);
  process.exit(1);
});
