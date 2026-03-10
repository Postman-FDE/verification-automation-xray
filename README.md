# Verification Automation Platform

Automates the manual test execution process: creates Jira Test Plans + Protocols, runs Newman collections against level-specific environments (Dev/IV/VV), and uploads evidence to Jira Test Executions. Inherits metadata (labels, fix versions, components, assignee) from the Test Plan and transitions issue status automatically.

## First-Time Setup

### Prerequisites

- Node.js (v18+)
- npm
- Git

### 1. Install dependencies

```bash
npm install
```

### 2. Configure credentials

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_EMAIL` | Yes | Email associated with your Jira account |
| `JIRA_API_TOKEN` | Yes | Jira API token ([create one here](https://id.atlassian.com/manage-profile/security/api-tokens)) |
| `JIRA_BASE_URL` | Yes | Your Jira instance URL (e.g. `https://your-org.atlassian.net`) |
| `XRAY_CLIENT_ID` | Yes | Xray Cloud API client ID ([generate in Xray settings](https://docs.getxray.app/display/XRAYCLOUD/Global+Settings%3A+API+Keys)) |
| `XRAY_CLIENT_SECRET` | Yes | Xray Cloud API client secret |
| `JIRA_ASSIGNEE_ACCOUNT_ID` | No | Jira account ID to assign Test Executions to. Find it in your Jira profile URL or via the API. |
| `TRANSITION_ON_PASS` | No | Status to transition to when tests pass (default: `Start Approvals`) |
| `TRANSITION_ON_FAIL` | No | Status to transition to when tests fail (default: `Done`) |

### 3. Verify connectivity

```bash
node run.js <TEST_PLAN_KEY>
```

If credentials are correct, you'll see the test plan name and a list of protocols.

## Usage

### Step 1: Create Test Plan + Protocols

```bash
node create-test-plan.js lc3-15647-config.json
```

Creates 1 Test Plan and 4 Test Protocols in Jira from the config file. Each protocol has a structured description with collection file, environment file, Newman command, execution steps, and evidence requirements.

### Step 2: Execute Protocols

Run a specific protocol:

```bash
node run.js PF-515 --protocols PF-516 --vv
```

Run all protocols:

```bash
node run.js PF-515 --all --dev
```

Run with a specific assignee:

```bash
node run.js PF-515 --all --vv --assignee 712020:a428f9e7-xxxx
```

Interactive mode (prompts for protocol and level selection):

```bash
node run.js PF-515
```

This will:
1. Fetch protocol details from Jira
2. Fetch Test Plan metadata (labels, fix versions)
3. Find the collection file and the level-specific environment file
4. Run Newman against the selected environment
5. Create a Test Execution in Jira (e.g. `Test Execution for Test Plan PF-515 | LC3 Protocol - Delete User (CAPI API)`)
6. Link it to the Test Plan and Protocol
7. Attach all evidence files
8. Set labels, fix versions, and assignee on the Test Execution (inherited from Test Plan)
9. Transition the Test Execution status (pass -> configurable status, fail -> configurable status)

### Test Levels and Environment Files

Tests run at 3 levels: `Dev`, `IV` (Informal Verification), `VV` (Formal Verification). Each level has its own environment file in `postman-environments/`:

```
postman-environments/
├── Dev.postman_environment.json
├── IV.postman_environment.json
└── VV.postman_environment.json
```

The selected level determines which environment file Newman runs against. Use shorthand flags or `--level`:

```bash
node run.js PF-515 --all --dev         # uses Dev.postman_environment.json
node run.js PF-515 --all --iv          # uses IV.postman_environment.json
node run.js PF-515 --all --vv          # uses VV.postman_environment.json
node run.js PF-515 --all --level Dev   # same as --dev
```

Collections stay in `collections/` and are resolved from the Jira protocol description. Only the environment changes per level.

## Evidence

Each Test Execution gets 4 files attached automatically:

| File | What It Is |
|------|------------|
| `newman_version.txt` | Newman CLI version used for the run |
| `<protocol>_Results.html` | Newman HTML report (full test results, viewable in browser) |
| `<protocol>_Results.json` | Raw JSON test results |
| `run_metadata.json` | Git branch, commit SHA, Newman version, timestamp, test level, environment file used |

## Metadata Inheritance

The script reads the following fields from the **Test Plan** and copies them to each **Test Execution** it creates:

- **Labels** -- e.g. `VV-R1`, `dsar-capi-regression`. Used to filter documentation suites.
- **Fix Versions** -- e.g. `1.0.2`. Tracks which release the execution belongs to.
- **Components** -- copied from the Test Plan when present.
- **Assignee** -- priority chain: `--assignee` CLI flag > `JIRA_ASSIGNEE_ACCOUNT_ID` env var > Test Plan assignee (auto-inherited).

## Status Transitions

After creating the Test Execution and attaching evidence, the script automatically transitions the issue status:

- **Tests pass** -> transitions to `TRANSITION_ON_PASS` (default: `Start Approvals`)
- **Tests fail** -> transitions to `TRANSITION_ON_FAIL` (default: `Done`)

These are configurable in `.env` to match the target Jira workflow. If a transition name doesn't match any available transition on the issue, the script warns and continues without crashing.

## Protocol Description Requirements

The automation parses the Jira **Test Protocol description** to find which collection to run. Protocols must follow this format in their description:

**Required:**

| Requirement | Format | Example |
|-------------|--------|---------|
| Test must be linked to the Test Plan in Xray | Add tests via Xray's "Add Tests" in the Test Plan | Tests tab on the Test Plan issue |
| `Collection File:` in description | Must end in `.postman_collection.json` | `Collection File: Order_API_Create_Order.postman_collection.json` |

The tool discovers tests via the Xray API — it queries for all tests linked to the given Test Plan. The collection file must exist in the `collections/` folder. If `Collection File:` is missing or the file is not found, the script will stop with an error.

**Optional fields (parsed if present):**

| Field | Format | What It Does |
|-------|--------|-------------|
| `Environment File:` | Must end in `.postman_environment.json` | Fallback env file if no level-specific file exists in `postman-environments/` |
| `reporter-html-export <name>.html` | In the Newman command template | Sets the report file name. Defaults to the protocol key (e.g. `PF_629`) |
| GitHub URL | `https://github.com/...` | Stored in protocol metadata |

**Example protocol description:**

```
## Protocol Library
Collection File:
Order_API_Create_Order.postman_collection.json

Environment File:
Dev.postman_environment.json

## Required Environment Variables
1. orderBaseUrl
2. tenantId
3. Order_Client_Id
```

The environment file in the description is a fallback — when you run with `--dev`, `--iv`, or `--vv`, the tool uses the level-specific file from `postman-environments/` instead.

## Config File

See `lc3-15647-config.json` or `order-mgmt-config.json` for the structure. The config is used by `create-test-plan.js` to create the Test Plan and Protocols in Jira with properly formatted descriptions.

## What This Replaces

**Manual process (per protocol, per test level, per release):**
1. Clone repo and navigate to test code
2. Run `newman -v` and capture screenshot
3. Run Newman collection
4. Capture HTML report
5. Create Test Execution issue in Jira
6. Manually type: "Test Execution for Test Plan LC3-15647 | Protocol Name"
7. Upload evidence files
8. Set labels, fix versions, assignee manually
9. Change status to Done / Start Approvals manually
10. Repeat

**Automated:**
```bash
node run.js PF-515 --all --vv
```

## Under the Hood

For a detailed walkthrough of what happens when you run the script (Jira fetch, Newman execution, reporters, pass/fail, evidence upload), see **[process.md](process.md)**.

## Next Steps

- [ ] **Newman -> Postman CLI migration:** Replace Newman with the Postman CLI (`postman collection run`), which is the actively maintained successor with all future product enhancements. Newman is in maintenance mode. Postman CLI now supports HTML reports, which was the previous blocker.
- [ ] **Test Executions under Test Plan:** Executions created by the script are linked to the Test Plan via Jira issue links but do not appear in Xray's "Test Executions" panel for the plan. Investigate Xray-specific link type or API so executions show under the plan's Test Executions list.
