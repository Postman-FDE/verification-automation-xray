#!/usr/bin/env node

/**
 * Create Test Plan and Test Protocols in Jira
 * 
 * Usage:
 *   node create-test-plan.js <config_file.json>
 * 
 * Example:
 *   node create-test-plan.js lc3-15647-config.json
 * 
 * Environment variables required:
 *   JIRA_EMAIL
 *   JIRA_API_TOKEN
 *   JIRA_BASE_URL
 */

import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// Parse args
const [configFile] = process.argv.slice(2);

if (!configFile) {
  console.error('Usage: node create-test-plan.js <config_file.json>');
  console.error('Example: node create-test-plan.js lc3-15647-config.json');
  process.exit(1);
}

const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;

if (!JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_BASE_URL) {
  console.error('❌ Missing Jira credentials');
  console.error('   Set JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_BASE_URL in .env');
  process.exit(1);
}

// Jira API helpers
function getAuthHeader() {
  const authString = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  return `Basic ${authString}`;
}

function textToADF(text) {
  const lines = text.split('\n');
  const content = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Heading: ## Title
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      content.push({
        type: 'heading',
        attrs: { level: headingMatch[1].length },
        content: [{ type: 'text', text: headingMatch[2] }]
      });
      i++;
      continue;
    }
    
    // Bullet list: consecutive lines starting with "- "
    if (line.match(/^-\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^-\s+/)) {
        items.push({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: lines[i].replace(/^-\s+/, '') }]
          }]
        });
        i++;
      }
      content.push({ type: 'bulletList', content: items });
      continue;
    }
    
    // Numbered list: consecutive lines starting with "1. ", "2. ", etc.
    if (line.match(/^\d+\.\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: lines[i].replace(/^\d+\.\s+/, '') }]
          }]
        });
        i++;
      }
      content.push({ type: 'orderedList', content: items });
      continue;
    }
    
    // Code block: line starting with "newman " or known commands
    if (line.match(/^newman\s+run\s+/)) {
      content.push({
        type: 'codeBlock',
        attrs: { language: 'bash' },
        content: [{ type: 'text', text: line }]
      });
      i++;
      continue;
    }
    
    // Empty line: skip
    if (line.trim() === '') {
      i++;
      continue;
    }
    
    // Bold label line: "Something:" pattern
    if (line.match(/^[A-Z][^:]+:\s*$/)) {
      content.push({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: line,
          marks: [{ type: 'strong' }]
        }]
      });
      i++;
      continue;
    }
    
    // Label with value: "Key:\nValue"
    if (line.match(/^[A-Z][^:]+:\s*.+/)) {
      const [label, ...rest] = line.split(':');
      content.push({
        type: 'paragraph',
        content: [
          { type: 'text', text: label + ': ', marks: [{ type: 'strong' }] },
          { type: 'text', text: rest.join(':').trim() }
        ]
      });
      i++;
      continue;
    }
    
    // Regular paragraph
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: line }]
    });
    i++;
  }
  
  if (content.length === 0) {
    content.push({ type: 'paragraph', content: [] });
  }
  
  return { type: 'doc', version: 1, content };
}

async function createTestPlan(planConfig) {
  const issueData = {
    fields: {
      project: { key: planConfig.projectKey },
      summary: planConfig.summary,
      description: textToADF(planConfig.description),
      issuetype: { name: 'Test Plan' }
    }
  };
  
  const response = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(issueData)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create Test Plan: ${response.status} - ${error}`);
  }
  
  return await response.json();
}

async function createTestProtocol(protocolConfig, testPlanKey) {
  const issueData = {
    fields: {
      project: { key: protocolConfig.projectKey },
      summary: protocolConfig.summary,
      description: textToADF(protocolConfig.description),
      issuetype: { name: 'Test' }
    }
  };
  
  const response = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(issueData)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create Test Protocol: ${response.status} - ${error}`);
  }
  
  const protocol = await response.json();
  
  return protocol;
}

// Main
(async () => {
  try {
    // Load config
    console.log('\n📋 Loading configuration...');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    console.log(`   Project: ${config.projectKey}`);
    console.log(`   Test Plan: ${config.testPlan.summary}`);
    console.log(`   Protocols: ${config.protocols.length}`);
    
    // Create Test Plan
    console.log('\n📝 Creating Test Plan...');
    const testPlan = await createTestPlan({
      projectKey: config.projectKey,
      summary: config.testPlan.summary,
      description: config.testPlan.description
    });
    
    console.log(`✅ Created Test Plan: ${testPlan.key}`);
    console.log(`   View at: ${JIRA_BASE_URL}/browse/${testPlan.key}`);
    
    // Create Test Protocols
    console.log('\n📝 Creating Test Protocols...');
    const protocols = [];
    
    for (const protocolConfig of config.protocols) {
      console.log(`\n   Creating: ${protocolConfig.summary}`);
      const protocol = await createTestProtocol({
        projectKey: config.projectKey,
        summary: protocolConfig.summary,
        description: protocolConfig.description
      }, testPlan.key);
      
      console.log(`   ✅ Created: ${protocol.key}`);
      protocols.push(protocol);
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ Test Plan Setup Complete');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Test Plan: ${testPlan.key}`);
    console.log(`Protocols:`);
    protocols.forEach(p => console.log(`  - ${p.key}: ${config.protocols.find(pc => pc.summary.includes(p.key) || true)?.summary || 'Protocol'}`));
    console.log(`\nView Test Plan: ${JIRA_BASE_URL}/browse/${testPlan.key}\n`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
