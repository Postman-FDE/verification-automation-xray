#!/usr/bin/env node

/**
 * Interactive CLI to execute Test Protocols
 *
 * Fetches protocols from Jira, lets you pick which to run, and executes them.
 *
 * Interactive:
 *   node run.js PF-501
 *
 * Non-interactive (CI/scripts):
 *   node run.js PF-501 --all --level VV
 */

import readline from 'readline';
import { program } from 'commander';
import dotenv from 'dotenv';
import { getAuthHeader, getJiraBaseUrl, checkCredentials, executeProtocol, fetchTestPlanMetadata } from './execute-protocol.js';
import { parseInteractiveSelection, resolveProtocolIndices, resolveTestLevel } from './run-selection.js';

dotenv.config();
checkCredentials();

const JIRA_BASE_URL = getJiraBaseUrl();

// Fetch all Test issues in the same project created around the test plan
async function fetchProtocols(testPlanKey) {
  const projectKey = testPlanKey.split('-')[0];

  // Get the test plan first to find its creation date
  const planResponse = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${testPlanKey}?fields=summary,created`, {
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json'
    }
  });

  if (!planResponse.ok) {
    throw new Error(`Failed to fetch Test Plan ${testPlanKey}: ${planResponse.status}`);
  }

  const plan = await planResponse.json();

  // Search for Test issues in the same project
  const jql = `project = "${projectKey}" AND issuetype = Test AND summary ~ "Protocol" ORDER BY key ASC`;
  const url = `${JIRA_BASE_URL}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key,summary&maxResults=50`;

  const response = await fetch(url, {
    headers: {
      'Authorization': getAuthHeader(),
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to search protocols: ${response.status}`);
  }

  const data = await response.json();
  const protocols = (data.issues || []).map(issue => ({
    key: issue.key,
    summary: issue.fields.summary
  }));

  return { plan, protocols };
}

function prompt(rl, question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

// Parse CLI flags for non-interactive mode
function parseFlags() {
  program
    .argument('<testPlanKey>', 'Jira Test Plan key (e.g. PF-501)')
    .option('--all', 'run all protocols non-interactively')
    .option('--level <level>', 'verification level (Dev, IV, VV)')
    .option('--dev', 'shortcut for --level Dev')
    .option('--iv', 'shortcut for --level IV')
    .option('--vv', 'shortcut for --level VV')
    .option('--protocols <keys>', 'comma-separated protocol keys to run')
    .option('--assignee <assignee>', 'assignee filter')
    .parse();

  const opts = program.opts();
  const level = opts.dev ? 'Dev' : opts.iv ? 'IV' : opts.vv ? 'VV' : opts.level ?? null;
  const protocolKeys = opts.protocols ? opts.protocols.split(',').map(s => s.trim()) : null;

  return {
    testPlanKey: program.processedArgs[0],
    all: opts.all ?? false,
    level,
    protocolKeys,
    assignee: opts.assignee ?? null
  };
}

const TEST_LEVELS = ['Dev', 'IV', 'VV'];

async function main() {
  const flags = parseFlags();

  if (!flags.testPlanKey || flags.testPlanKey.startsWith('--')) {
    console.error('Usage:');
    console.error('  Interactive:      node run.js <test_plan_key>');
    console.error('  Non-interactive:  node run.js <test_plan_key> --all --level VV');
    console.error('  Shorthand:        node run.js <test_plan_key> --all --dev|--iv|--vv');
    console.error('  Select specific:  node run.js <test_plan_key> --protocols 1,3 --vv');
    process.exit(1);
  }

  const testPlanKey = flags.testPlanKey;
  const isInteractive = !flags.all && !flags.protocolKeys;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('           VERIFICATION AUTOMATION PLATFORM');
  console.log('═══════════════════════════════════════════════════════════');

  // Fetch protocols and test plan metadata
  console.log(`\n  Fetching protocols for Test Plan ${testPlanKey}...\n`);
  const { plan, protocols } = await fetchProtocols(testPlanKey);
  const planMetadata = await fetchTestPlanMetadata(testPlanKey);

  console.log(`  Test Plan: ${plan.fields.summary}`);
  if (planMetadata.labels.length) console.log(`  Labels: ${planMetadata.labels.join(', ')}`);
  if (planMetadata.fixVersions.length) console.log(`  Fix Versions: ${planMetadata.fixVersions.map(v => v.name).join(', ')}`);

  if (protocols.length === 0) {
    console.log('\n  No protocols found. Make sure Test issues with "Protocol" in the summary exist.');
    process.exit(0);
  }

  // Display protocols
  console.log(`\n  Found ${protocols.length} protocol(s):\n`);
  protocols.forEach((p, i) => {
    console.log(`    [${i + 1}] ${p.key}  ${p.summary}`);
  });

  let selectedIndices;
  let testLevel;

  if (isInteractive) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Select protocols
    console.log('');
    const selection = await prompt(rl, '  Which protocols to run? (all, or comma-separated: 1,3): ');
    selectedIndices = parseInteractiveSelection(selection, protocols);

    if (selectedIndices.length === 0) {
      console.log('\n  No valid protocols selected.');
      rl.close();
      process.exit(0);
    }

    // Select test level
    console.log('\n  Select test level:');
    TEST_LEVELS.forEach((level, i) => {
      console.log(`    [${i + 1}] ${level}`);
    });
    console.log('');
    const levelInput = await prompt(rl, '  Test level number: ');

    testLevel = resolveTestLevel(levelInput, TEST_LEVELS);
    if (!testLevel) {
      console.log(`\n  Invalid test level. Must be one of: ${TEST_LEVELS.join(', ')}`);
      rl.close();
      process.exit(1);
    }

    rl.close();

  } else {
    // Non-interactive mode
    if (flags.all) {
      selectedIndices = [...protocols.keys()];
    } else {
      selectedIndices = resolveProtocolIndices(flags.protocolKeys, protocols);
    }

    testLevel = flags.level ? resolveTestLevel(flags.level, TEST_LEVELS) : null;
    if (!testLevel) {
      console.error(`\n  Invalid test level "${flags.level}". Must be one of: ${TEST_LEVELS.join(', ')}`);
      process.exit(1);
    }
  }

  const selected = selectedIndices.map(i => protocols[i]);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Running ${selected.length} protocol(s) at ${testLevel} level`);
  console.log('═══════════════════════════════════════════════════════════');

  // Execute each selected protocol
  const results = [];
  const execOptions = {
    labels: planMetadata.labels,
    fixVersions: planMetadata.fixVersions,
    components: planMetadata.components,
    assignee: flags.assignee,
    testPlanAssignee: planMetadata.assignee?.accountId || null
  };

  for (const protocol of selected) {
    try {
      const result = await executeProtocol(testPlanKey, protocol.key, testLevel, execOptions);
      results.push(result);
    } catch (err) {
      console.error(`\n  ❌ Failed: ${protocol.key} - ${err.message}`);
      results.push({ key: null, status: 'Error', protocol: protocol.summary, error: err.message });
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  EXECUTION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Test Plan:  ${testPlanKey}`);
  console.log(`  Level:      ${testLevel}`);
  console.log(`  Protocols:  ${results.length}`);
  console.log('');

  for (const r of results) {
    const icon = r.status === 'Passed' ? '✅' : r.status === 'Failed' ? '⚠️' : '❌';
    const exec = r.key ? `→ ${r.key}` : `→ ${r.error}`;
    console.log(`  ${icon} ${r.protocol}  ${exec}`);
  }

  const passed = results.filter(r => r.status === 'Passed').length;
  const failed = results.filter(r => r.status === 'Failed').length;
  const errors = results.filter(r => r.status === 'Error').length;

  console.log('');
  console.log(`  Passed: ${passed}  |  Failed: ${failed}  |  Errors: ${errors}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
