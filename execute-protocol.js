#!/usr/bin/env node

/**
 * Execute Test Protocol and create Test Execution in Jira
 *
 * Standalone usage:
 *   node execute-protocol.js <test_plan_key> <protocol_key> <test_level>
 *
 * Example:
 *   node execute-protocol.js PF-501 PF-502 VV
 *
 * Also importable by run.js for interactive CLI use.
 */

import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_SUFFIX = '.postman_environment.json';

const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const XRAY_CLIENT_ID = process.env.XRAY_CLIENT_ID;
const XRAY_CLIENT_SECRET = process.env.XRAY_CLIENT_SECRET;
export const XRAY_BASE_URL = 'https://xray.cloud.getxray.app';
const JIRA_ASSIGNEE_ACCOUNT_ID = process.env.JIRA_ASSIGNEE_ACCOUNT_ID;
const TRANSITION_ON_PASS = process.env.TRANSITION_ON_PASS || 'Start Approvals';
const TRANSITION_ON_FAIL = process.env.TRANSITION_ON_FAIL || 'Done';
const SKIP_DIRS = new Set(['node_modules', '.git', 'output']);

export function getSearchRoot() {
  return path.resolve(__dirname, '..');
}

export function findFileRecursive(dir, fileName) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === fileName) return fullPath;
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, fileName);
        if (found) return found;
      }
    }
  } catch { /* permission errors, etc. */ }
  return null;
}

export function findFilesRecursive(dir, suffix) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(suffix)) results.push(fullPath);
      if (entry.isDirectory()) results.push(...findFilesRecursive(fullPath, suffix));
    }
  } catch { /* permission errors, etc. */ }
  return results;
}

let xrayToken = null;

export async function xrayAuthenticate() {
  if (xrayToken) return xrayToken;

  const response = await fetch(`${XRAY_BASE_URL}/api/v2/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: XRAY_CLIENT_ID,
      client_secret: XRAY_CLIENT_SECRET
    })
  });

  if (!response.ok) {
    throw new Error(`Xray auth failed: ${response.status}`);
  }

  const token = await response.text();
  xrayToken = token.replace(/"/g, '');
  return xrayToken;
}

// Jira API helpers
export function getAuthHeader() {
  const authString = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  return `Basic ${authString}`;
}

export function getJiraBaseUrl() {
  return JIRA_BASE_URL;
}

/** Jira REST request with auth. path is full URL or path (e.g. /rest/api/3/issue/X). */
async function jiraRequest(path, options = {}) {
  const url = path.startsWith('http') ? path : `${JIRA_BASE_URL}${path}`;
  const headers = {
    'Authorization': getAuthHeader(),
    'Accept': 'application/json',
    ...options.headers
  };
  if (options.body !== undefined && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options = { ...options, body: JSON.stringify(options.body) };
  }
  return fetch(url, { ...options, headers });
}

/** Jira REST request that returns JSON and throws on non-OK. */
async function jiraJson(path, options = {}) {
  const res = await jiraRequest(path, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira request failed: ${res.status} - ${text}`);
  }
  return res.json();
}

/** Xray API request with Bearer auth. path is full URL or path under XRAY_BASE_URL. */
async function xrayRequest(path, options = {}) {
  const url = path.startsWith('http') ? path : `${XRAY_BASE_URL}${path}`;
  const token = await xrayAuthenticate();
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (options.body !== undefined && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options = { ...options, body: JSON.stringify(options.body) };
  }
  return fetch(url, { ...options, headers });
}

/** Xray API request that returns JSON and throws on non-OK. */
async function xrayJson(path, options = {}) {
  const res = await xrayRequest(path, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xray request failed: ${res.status} - ${text}`);
  }
  return res.json();
}

export function checkCredentials() {
  if (!JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_BASE_URL) {
    console.error('❌ Missing Jira credentials in .env');
    process.exit(1);
  }
  if (!XRAY_CLIENT_ID || !XRAY_CLIENT_SECRET) {
    console.error('❌ Missing Xray credentials in .env (XRAY_CLIENT_ID, XRAY_CLIENT_SECRET)');
    process.exit(1);
  }
}

function textToADF(text) {
  const lines = text.split('\n');
  const content = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

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

    if (line.trim() === '') { i++; continue; }

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

export async function getProtocol(protocolKey) {
  const issue = await jiraJson(`/rest/api/3/issue/${protocolKey}`);

  let descriptionText = '';
  if (issue.fields.description?.content) {
    descriptionText = issue.fields.description.content
      .map(block => block.content?.map(item => item.text).join('') || '')
      .join('\n');
  }

  const collectionMatch = descriptionText.match(/(\S+\.postman_collection\.json)/);
  const reportMatch = descriptionText.match(/reporter-html-export\s+(\S+)\.html/);
  const repoMatch = descriptionText.match(/https:\/\/github\.com\/[^\s]+/);

  return {
    key: protocolKey,
    summary: issue.fields.summary,
    collectionFile: collectionMatch ? collectionMatch[1] : null,
    reportName: reportMatch ? reportMatch[1] : protocolKey.replace(/-/g, '_'),
    repoUrl: repoMatch ? repoMatch[0] : null
  };
}

async function createTestExecution(testPlanKey, protocol, testLevel, evidence) {
  const projectKey = testPlanKey.split('-')[0];
  const executionSummary = `Test Execution for Test Plan ${testPlanKey} | ${protocol.summary}`;

  const description = `Execution Level: ${testLevel}\n` +
    `Test Plan: ${testPlanKey}\n` +
    `Test Protocol: ${protocol.key}\n` +
    `Newman Version: ${evidence.newmanVersion}\n` +
    `Execution Timestamp: ${evidence.timestamp}\n` +
    `Collection: ${protocol.collectionFile}\n` +
    `Environment: ${evidence.environmentFile}\n` +
    `Status: ${evidence.status}`;

  const payload = {
    info: {
      project: projectKey,
      summary: executionSummary,
      description: description,
      startDate: evidence.timestamp,
      finishDate: new Date().toISOString(),
      testPlanKey: testPlanKey
    },
    tests: [
      {
        testKey: protocol.key,
        status: evidence.status === 'Passed' ? 'PASSED' : 'FAILED',
        comment: `Execution Level: ${testLevel}\nNewman Version: ${evidence.newmanVersion}\nCollection: ${protocol.collectionFile}`
      }
    ]
  };

  return xrayJson('/api/v2/import/execution', { method: 'POST', body: payload });
}

async function attachFile(issueKey, filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`   ⚠️  File not found: ${filePath}`);
    return;
  }

  const fileContent = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const blob = new Blob([fileContent]);
  const formData = new FormData();
  formData.append('file', blob, fileName);

  const response = await jiraRequest(`/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: { 'X-Atlassian-Token': 'no-check' },
    body: formData
  });

  if (response.ok) {
    console.log(`   ✅ Attached: ${fileName}`);
  } else {
    console.warn(`   ⚠️  Failed to attach: ${fileName}`);
  }
}

export async function fetchTestPlanMetadata(testPlanKey) {
  const SPRINT_FIELD = process.env.JIRA_SPRINT_FIELD || 'customfield_10006';
  const fields = `labels,fixVersions,assignee,status,components,priority,${SPRINT_FIELD}`;
  const response = await jiraRequest(`/rest/api/3/issue/${testPlanKey}?fields=${fields}`);

  if (!response.ok) {
    console.warn(`   ⚠️  Could not fetch Test Plan metadata: ${response.status}`);
    return { labels: [], fixVersions: [], assignee: null, status: null, components: [], priority: null, sprint: null };
  }

  const issue = await response.json();
  const f = issue.fields;

  const sprintData = f[SPRINT_FIELD];
  const activeSprint = Array.isArray(sprintData)
    ? sprintData.find(s => s.state === 'active') || sprintData[0]
    : sprintData;

  return {
    labels: f.labels || [],
    fixVersions: (f.fixVersions || []).map(v => ({ id: v.id, name: v.name })),
    assignee: f.assignee ? { accountId: f.assignee.accountId, displayName: f.assignee.displayName } : null,
    status: f.status ? { id: f.status.id, name: f.status.name } : null,
    components: (f.components || []).map(c => ({ id: c.id, name: c.name })),
    priority: f.priority ? { id: f.priority.id, name: f.priority.name } : null,
    sprint: activeSprint ? { id: activeSprint.id, name: activeSprint.name, state: activeSprint.state } : null
  };
}

async function updateExecutionFields(executionKey, { labels, fixVersions, assignee, components }) {
  const fields = {};

  if (labels?.length) fields.labels = labels;
  if (fixVersions?.length) fields.fixVersions = fixVersions;
  if (components?.length) fields.components = components;
  if (assignee) fields.assignee = { accountId: assignee };

  if (Object.keys(fields).length === 0) return;

  const response = await jiraRequest(`/rest/api/3/issue/${executionKey}`, {
    method: 'PUT',
    body: { fields }
  });

  if (response.ok || response.status === 204) {
    if (labels?.length) console.log(`   ✅ Labels set: ${labels.join(', ')}`);
    if (fixVersions?.length) console.log(`   ✅ Fix versions set: ${fixVersions.map(v => v.name).join(', ')}`);
    if (components?.length) console.log(`   ✅ Components set: ${components.map(c => c.name).join(', ')}`);
    if (assignee) console.log(`   ✅ Assignee set: ${assignee}`);
  } else {
    const error = await response.text();
    console.warn(`   ⚠️  Failed to update execution fields: ${response.status} - ${error}`);
  }
}

async function transitionExecution(executionKey, targetStatusName) {
  const response = await jiraRequest(`/rest/api/3/issue/${executionKey}/transitions`);
  if (!response.ok) {
    console.warn(`   ⚠️  Could not fetch transitions for ${executionKey}: ${response.status}`);
    return;
  }

  const { transitions } = await response.json();
  const transition = transitions.find(t =>
    t.name.toLowerCase() === targetStatusName.toLowerCase()
  );
  if (!transition) {
    const available = transitions.map(t => t.name).join(', ');
    console.warn(`   ⚠️  Transition "${targetStatusName}" not available. Available: ${available}`);
    return;
  }

  const transResponse = await jiraRequest(`/rest/api/3/issue/${executionKey}/transitions`, {
    method: 'POST',
    body: { transition: { id: transition.id } }
  });

  if (transResponse.ok || transResponse.status === 204) {
    console.log(`   ✅ Status transitioned to: ${targetStatusName}`);
  } else {
    const error = await transResponse.text();
    console.warn(`   ⚠️  Failed to transition to "${targetStatusName}": ${transResponse.status} - ${error}`);
  }
}

/**
 * Execute a single protocol: run Newman, create Jira Test Execution, attach evidence.
 *
 * @param {string} testPlanKey - e.g. "PF-501"
 * @param {string} protocolKey - e.g. "PF-502"
 * @param {string} testLevel - environment name
 * @param {object} options - { labels, fixVersions, components, assignee, testPlanAssignee, transitionOnPass, transitionOnFail, protocolDetails, envFilePath }
 * @returns {Promise<{key: string, status: string}>} - created execution key and pass/fail status
 */
export async function executeProtocol(testPlanKey, protocolKey, testLevel, options = {}) {
  const protocol = options.protocolDetails || await getProtocol(protocolKey);

  let collectionPath = protocol.collectionFile;
  let envPath = null;

  if (!collectionPath) {
    throw new Error(`Collection file not found in ${protocolKey} description`);
  }

  // Resolve collection: recursively search the parent directory
  const found = findFileRecursive(getSearchRoot(), collectionPath);
  if (found) {
    collectionPath = found;
  } else {
    throw new Error(`Collection file not found: ${collectionPath}\n   Searched: ${getSearchRoot()} recursively`);
  }

  // Resolve environment file
  if (options.envFilePath && fs.existsSync(options.envFilePath)) {
    envPath = options.envFilePath;
  }

  const resolvedLevel = envPath ? path.basename(envPath).replace(ENV_SUFFIX, '') : testLevel || 'none';

  console.log('\n───────────────────────────────────────────────────────────');
  console.log(`  Executing: ${protocolKey}  |  Environment: ${resolvedLevel}`);
  console.log('───────────────────────────────────────────────────────────');
  console.log(`   Protocol: ${protocol.summary}`);
  console.log(`   Collection: ${collectionPath}`);
  console.log(`   Environment: ${envPath || '(none)'}`);
  if (envPath) console.log(`   Env file: ${path.relative(getSearchRoot(), envPath)}`);

  // Create output dir for evidence
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) { fs.mkdirSync(outputDir); }

  // Capture Newman version
  let newmanVersion;
  try {
    newmanVersion = execSync('npx newman -v', { encoding: 'utf8', cwd: __dirname }).trim();
    fs.writeFileSync(path.join(outputDir, 'newman_version.txt'), newmanVersion);
  } catch {
    throw new Error('Newman not installed. Run: npm install newman');
  }

  // Run Newman
  console.log(`\n   Running Newman...`);
  const jsonReport = path.join(outputDir, `${protocol.reportName}.json`);
  const htmlReport = path.join(outputDir, `${protocol.reportName}.html`);
  const newmanArgs = [
    'newman', 'run', collectionPath,
    ...(envPath ? ['-e', envPath] : []),
    '--insecure',
    '--ignore-redirects',
    '--reporters', 'cli,json,html',
    '--reporter-json-export', jsonReport,
    '--reporter-html-export', htmlReport
  ];

  let status = 'Passed';
  let cliOutput = '';
  try {
    cliOutput = execFileSync('npx', newmanArgs, { encoding: 'utf8', cwd: __dirname });
    console.log(cliOutput);
    console.log(`   ✅ Newman completed`);
  } catch (err) {
    cliOutput = err.stdout || '';
    console.log(cliOutput);
    console.log(`   ⚠️  Newman had failures`);
    status = 'Failed';
  }

  // Save CLI output as the newman report text file
  const cliReportPath = path.join(outputDir, `${protocol.reportName}_report.txt`);
  fs.writeFileSync(cliReportPath, cliOutput);

  // Create metadata
  const timestamp = new Date().toISOString();
  const metadata = {
    testPlanKey, protocolKey, testLevel: resolvedLevel,
    newmanVersion, timestamp,
    collectionFile: protocol.collectionFile,
    environmentFile: envPath ? path.basename(envPath) : 'none',
    status
  };
  const metadataPath = path.join(outputDir, 'run_metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  // Create Test Execution in Jira
  console.log(`\n   Creating Test Execution in Jira...`);
  const execution = await createTestExecution(testPlanKey, protocol, resolvedLevel, {
    newmanVersion, timestamp, status,
    environmentFile: envPath ? path.basename(envPath) : 'none'
  });
  console.log(`   ✅ Created: ${execution.key}`);

  // Attach evidence
  console.log(`\n   Attaching evidence...`);
  await attachFile(execution.key, path.join(outputDir, 'newman_version.txt'));
  await attachFile(execution.key, path.join(outputDir, `${protocol.reportName}.html`));
  await attachFile(execution.key, path.join(outputDir, 'run_metadata.json'));

  // Update execution fields (labels, fixVersions, components, assignee)
  // Assignee priority: explicit CLI flag > env var > inherited from test plan
  const assignee = options.assignee || JIRA_ASSIGNEE_ACCOUNT_ID || options.testPlanAssignee;
  const hasFields = options.labels?.length || options.fixVersions?.length || options.components?.length || assignee;
  if (hasFields) {
    console.log(`\n   Updating execution fields...`);
    await updateExecutionFields(execution.key, {
      labels: options.labels,
      fixVersions: options.fixVersions,
      components: options.components,
      assignee
    });
  }

  // Transition status based on pass/fail
  const transitionTarget = status === 'Passed'
    ? (options.transitionOnPass || TRANSITION_ON_PASS)
    : (options.transitionOnFail || TRANSITION_ON_FAIL);
  if (transitionTarget) {
    console.log(`\n   Transitioning status...`);
    await transitionExecution(execution.key, transitionTarget);
  }

  // Clean up output files now that evidence is pushed to Jira
  const filesToClean = [
    path.join(outputDir, 'newman_version.txt'),
    path.join(outputDir, 'run_metadata.json'),
    jsonReport,
    htmlReport,
    cliReportPath
  ];
  for (const f of filesToClean) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ }
  }

  console.log(`\n   ✅ Done: ${execution.key} (${status})`);
  console.log(`   View: ${JIRA_BASE_URL}/browse/${execution.key}`);

  return { key: execution.key, status, protocol: protocol.summary };
}

// CLI entrypoint — only runs when called directly
const isDirectRun = process.argv[1]?.endsWith('execute-protocol.js');
if (isDirectRun) {
  const [testPlanKey, protocolKey, testLevel] = process.argv.slice(2);

  if (!testPlanKey || !protocolKey) {
    console.error('Usage: node execute-protocol.js <test_plan_key> <protocol_key>');
    console.error('Example: node execute-protocol.js PF-501 PF-502');
    process.exit(1);
  }

  checkCredentials();

  fetchTestPlanMetadata(testPlanKey)
    .then(metadata => executeProtocol(testPlanKey, protocolKey, '', {
      labels: metadata.labels,
      fixVersions: metadata.fixVersions,
      components: metadata.components,
      testPlanAssignee: metadata.assignee?.accountId || null
    }))
    .then(result => {
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('✅ TEST EXECUTION COMPLETE');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`Test Execution: ${result.key}`);
      console.log(`Status: ${result.status}`);
      console.log('═══════════════════════════════════════════════════════════\n');
    })
    .catch(err => {
      console.error('\n❌ Error:', err.message);
      process.exit(1);
    });
}
