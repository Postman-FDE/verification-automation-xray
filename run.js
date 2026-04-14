#!/usr/bin/env node

/**
 * Interactive CLI to execute Test Protocols
 *
 * Fetches protocols from Jira, lets you pick which to run, and executes them.
 * Environment files are discovered from the parent directory and the user picks one.
 *
 * Interactive:
 *   node run.js PF-501
 *
 * Non-interactive (CI/scripts):
 *   node run.js PF-501 --all --env CAPI_Formal
 */

import readline from 'readline';
import path from 'path';
import { program } from 'commander';
import dotenv from 'dotenv';
import { getAuthHeader, getJiraBaseUrl, checkCredentials, executeProtocol, fetchTestPlanMetadata, getProtocol, findFilesRecursive, getSearchRoot } from './execute-protocol.js';

dotenv.config();
checkCredentials();

const ENV_SUFFIX = '.postman_environment.json';

const JIRA_BASE_URL = getJiraBaseUrl();

// Fetch tests linked to the test plan via Xray GraphQL
async function fetchProtocols(testPlanKey) {
  // Get the test plan summary from Jira
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

  // Authenticate with Xray
  const authResp = await fetch('https://xray.cloud.getxray.app/api/v2/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.XRAY_CLIENT_ID,
      client_secret: process.env.XRAY_CLIENT_SECRET
    })
  });

  if (!authResp.ok) {
    throw new Error(`Xray auth failed: ${authResp.status}`);
  }

  const xrayToken = (await authResp.text()).replace(/"/g, '');

  // Query Xray GraphQL for tests linked to this test plan
  const graphqlQuery = {
    query: `{ getTestPlans(limit: 1, jql: "key = ${testPlanKey}") { results { tests(limit: 100) { results { issueId jira(fields: ["key", "summary"]) } } } } }`
  };

  const gqlResp = await fetch('https://xray.cloud.getxray.app/api/v2/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${xrayToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(graphqlQuery)
  });

  if (!gqlResp.ok) {
    throw new Error(`Xray GraphQL query failed: ${gqlResp.status}`);
  }

  const gqlData = await gqlResp.json();
  const testPlanResults = gqlData.data?.getTestPlans?.results?.[0];
  const tests = testPlanResults?.tests?.results || [];

  const protocols = tests.map(t => ({
    key: t.jira.key,
    summary: t.jira.summary
  }));

  return { plan, protocols };
}

function prompt(rl, question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

function parseInteractiveSelection(input, protocols) {
  if (input.toLowerCase() === 'all') {
    return [...protocols.keys()];
  }
  return input.split(',')
    .map(s => parseInt(s.trim(), 10) - 1)
    .filter(i => i >= 0 && i < protocols.length);
}

function resolveProtocolIndices(keys, protocols) {
  if (!keys) return [];
  return keys.map(k => {
    const num = parseInt(k, 10);
    if (!isNaN(num) && num >= 1 && num <= protocols.length) return num - 1;
    const idx = protocols.findIndex(p => p.key === k);
    return idx >= 0 ? idx : -1;
  }).filter(i => i >= 0);
}

function discoverEnvironments() {
  const searchRoot = getSearchRoot();
  const found = findFilesRecursive(searchRoot, ENV_SUFFIX);
  return found
    .map(filePath => ({ name: path.basename(filePath).replace(ENV_SUFFIX, ''), filePath }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Parse CLI flags for non-interactive mode
function parseFlags() {
  program
    .argument('<testPlanKey>', 'Jira Test Plan key (e.g. PF-501)')
    .option('--all', 'run all protocols non-interactively')
    .option('--env <name>', 'environment name to run against (non-interactive)')
    .option('--protocols <keys>', 'comma-separated protocol keys to run')
    .option('--assignee <assignee>', 'assignee filter')
    .parse();

  const opts = program.opts();
  const protocolKeys = opts.protocols ? opts.protocols.split(',').map(s => s.trim()) : null;

  return {
    testPlanKey: program.processedArgs[0],
    all: opts.all ?? false,
    env: opts.env ?? null,
    protocolKeys,
    assignee: opts.assignee ?? null
  };
}

async function main() {
  const flags = parseFlags();

  if (!flags.testPlanKey || flags.testPlanKey.startsWith('--')) {
    console.error('Usage:');
    console.error('  Interactive:      node run.js <test_plan_key>');
    console.error('  Non-interactive:  node run.js <test_plan_key> --all --env <env_name>');
    console.error('  Select specific:  node run.js <test_plan_key> --protocols 1,3 --env <env_name>');
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
    console.log('\n  No tests found linked to this Test Plan. Add tests via Xray in Jira.');
    process.exit(0);
  }

  // Display protocols
  console.log(`\n  Found ${protocols.length} protocol(s):\n`);
  protocols.forEach((p, i) => {
    console.log(`    [${i + 1}] ${p.key}  ${p.summary}`);
  });

  let selectedIndices;
  let selectedEnv;

  // Discover all environment files in the parent directory
  const allEnvs = discoverEnvironments();
  if (allEnvs.length === 0) {
    console.log('\n  No *.postman_environment.json files found in the parent directory.');
    process.exit(1);
  }

  if (isInteractive) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Step 1: Pick protocols
    console.log('');
    const selection = await prompt(rl, '  Which protocols to run? (all, or comma-separated: 1,3): ');
    selectedIndices = parseInteractiveSelection(selection, protocols);

    if (selectedIndices.length === 0) {
      console.log('\n  No valid protocols selected.');
      rl.close();
      process.exit(0);
    }

    // Step 2: Pick environment
    console.log('\n  Available environments:\n');
    allEnvs.forEach((env, i) => {
      console.log(`    [${i + 1}] ${env.name}`);
    });
    console.log('');
    const envInput = await prompt(rl, '  Select environment (number or name): ');

    const envIndex = parseInt(envInput, 10) - 1;
    if (!isNaN(envIndex) && envIndex >= 0 && envIndex < allEnvs.length) {
      selectedEnv = allEnvs[envIndex];
    } else {
      selectedEnv = allEnvs.find(e => e.name === envInput);
    }

    if (!selectedEnv) {
      console.log(`\n  Invalid selection. Available: ${allEnvs.map(e => e.name).join(', ')}`);
      rl.close();
      process.exit(1);
    }

    rl.close();
  } else {
    // Non-interactive: resolve protocols
    if (flags.all) {
      selectedIndices = [...protocols.keys()];
    } else {
      selectedIndices = resolveProtocolIndices(flags.protocolKeys, protocols);
    }

    // Non-interactive: resolve environment by name
    if (!flags.env) {
      console.error('\n  --env <name> is required in non-interactive mode.');
      console.error(`  Available: ${allEnvs.map(e => e.name).join(', ')}`);
      process.exit(1);
    }
    selectedEnv = allEnvs.find(e => e.name === flags.env);
    if (!selectedEnv) {
      console.error(`\n  Environment "${flags.env}" not found.`);
      console.error(`  Available: ${allEnvs.map(e => e.name).join(', ')}`);
      process.exit(1);
    }
  }

  const selected = selectedIndices.map(i => protocols[i]);

  // Fetch protocol details once (collection name, etc.)
  console.log('\n  Fetching protocol details...');
  const protocolDetails = await Promise.all(selected.map(p => getProtocol(p.key)));

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Running ${selected.length} protocol(s) with ${selectedEnv.name}`);
  console.log('═══════════════════════════════════════════════════════════');

  const results = [];
  const execOptions = {
    labels: planMetadata.labels,
    fixVersions: planMetadata.fixVersions,
    components: planMetadata.components,
    assignee: flags.assignee,
    testPlanAssignee: planMetadata.assignee?.accountId || null,
    envFilePath: selectedEnv.filePath
  };

  for (let i = 0; i < selected.length; i++) {
    try {
      const opts = { ...execOptions, protocolDetails: protocolDetails[i] };
      const result = await executeProtocol(testPlanKey, selected[i].key, selectedEnv.name, opts);
      results.push(result);
    } catch (err) {
      console.error(`\n  ❌ Failed: ${selected[i].key} - ${err.message}`);
      results.push({ key: null, status: 'Error', protocol: selected[i].summary, error: err.message });
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  EXECUTION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Test Plan:     ${testPlanKey}`);
  console.log(`  Environment:   ${selectedEnv.name}`);
  console.log(`  Protocols:     ${results.length}`);
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
