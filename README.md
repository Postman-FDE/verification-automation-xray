# Verification Automation Platform

Automates the manual test execution process: creates Jira Test Plans + Protocols, runs Newman collections, and uploads evidence to Jira Test Executions.

## Setup

```bash
cd verification-automation
npm install
cp .env.example .env
# Edit .env with your Jira credentials
```

## Demo

For a detailed walkthrough of what happens when you run the demo (Jira fetch, Newman execution, reporters, pass/fail, evidence upload), see **[DEMO_UNDER_THE_HOOD.md](DEMO_UNDER_THE_HOOD.md)**.

### Step 1: Create Test Plan + Protocols

```bash
node create-test-plan.js lc3-15647-config.json
```

Creates 1 Test Plan and 4 Test Protocols in Jira from the config file. Each protocol has a structured description with collection file, environment file, Newman command, execution steps, and evidence requirements.

Open Jira and show the created Test Plan and one of the Protocols.

### Step 2: Execute a Protocol

```bash
node run.js <TEST_PLAN_KEY> --protocols <PROTOCOL_KEY> --level VV
```

Example (one protocol):

```bash
node run.js PF-515 --protocols PF-516 --level VV
```

Example (all protocols):

```bash
node run.js PF-515 --all --level VV
```

This will:
1. Fetch protocol details from Jira
2. Find the collection and environment files
3. Run Newman
4. Create a Test Execution in Jira: `Test Execution for Test Plan PF-515 | LC3 Protocol - Delete User (CAPI API)`
5. Link it to the Test Plan and Protocol
6. Attach all evidence

Open Jira and show the Test Execution with evidence attached.

## Evidence

Each Test Execution gets 4 files attached automatically:

| File | What It Is |
|------|------------|
| `newman_version.txt` | Newman CLI version used for the run |
| `<protocol>_Results.html` | Newman HTML report (full test results, viewable in browser) |
| `<protocol>_Results.json` | Raw JSON test results |
| `run_metadata.json` | Git branch, commit SHA, Newman version, timestamp, test level |

## Other Commands

### Interactive mode (pick which protocols to run)

```bash
node run.js PF-515
```

Shows a numbered list of protocols. Type `all` or `1,3` to select, then pick a test level.

### Run all protocols

```bash
node run.js PF-515 --all --level VV
```

### Run specific protocols by key

```bash
node run.js PF-515 --protocols PF-516,PF-517 --level VV
```

### Test levels

Lilly runs the same tests at 3 levels: `Dev`, `IV` (Informal Verification), `VV` (Formal Verification). The level is recorded in the Test Execution description as metadata.

## Config File

See `lc3-15647-config.json` for the structure. Each protocol defines:
- Summary
- Test objective
- Test code location (GitHub URL)
- Collection file name
- Environment file name
- Newman command template
- Required environment variables
- Execution steps
- Expected results
- Evidence checklist

## What This Replaces

**Manual process (per protocol, per test level, per release):**
1. Clone repo and navigate to test code
2. Run `newman -v` and capture screenshot
3. Run Newman collection
4. Capture HTML report
5. Create Test Execution issue in Jira
6. Manually type: "Test Execution for Test Plan LC3-15647 | Protocol Name"
7. Upload evidence files
8. Repeat

**Automated:**
```bash
node run.js PF-515 --protocols PF-516 --level VV
```

## To-do

- [ ] **Test Executions under Test Plan:** Executions created by the script are linked to the Test Plan via Jira issue links but do not appear in Xray's "Test Executions" panel for the plan (e.g. "This test plan hasn't been executed, yet"). Investigate Xray-specific link type or API so executions show under the plan's Test Executions list.
