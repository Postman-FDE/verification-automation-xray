# Verification Automation Platform

Automates the manual test execution workflow for Jira/Xray: runs Postman collections via Newman, creates Test Executions in Jira, uploads evidence, inherits metadata from the Test Plan, and transitions issue status — all in a single command.

Designed to be **dropped into any existing repo** that already contains Postman collections and environments.

## Quick Start

```bash
# 1. Clone into your test repo
cd your-test-repo
git clone https://github.com/Postman-FDE/verification-automation-xray.git
cd verification-automation-xray

# 2. Install dependencies
npm install

# 3. Configure credentials
cp .env.example .env
# Edit .env with your Jira + Xray credentials

# 4. Run
node run.js <TEST_PLAN_KEY>
```

## How It Works

The script searches the **parent directory** recursively for collection and environment files — no need to copy files into specific folders.

```
your-test-repo/
├── CAPI Tests/
│   ├── CAPI_API_Delete_User.postman_collection.json
│   └── CAPI_Formal.postman_environment.json
├── verification-automation-xray/   ← this repo
│   ├── .env
│   ├── run.js
│   └── execute-protocol.js
└── ...
```

## Credentials

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_EMAIL` | Yes | Jira account email |
| `JIRA_API_TOKEN` | Yes | [Generate here](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_BASE_URL` | Yes | e.g. `https://your-org.atlassian.net` |
| `XRAY_CLIENT_ID` | Yes | Jira → Apps → Xray → Settings → API Keys |
| `XRAY_CLIENT_SECRET` | Yes | Generated alongside Client ID |
| `JIRA_ASSIGNEE_ACCOUNT_ID` | No | Overrides Test Execution assignee |
| `TRANSITION_ON_PASS` | No | Status on pass (default: `Start Approvals`) |
| `TRANSITION_ON_FAIL` | No | Status on fail (default: `Done`) |

## Usage

### Interactive

```bash
node run.js PF-515
```

Prompts you to select which protocols to run and which environment to use.

### Non-interactive

```bash
node run.js PF-515 --all --env CAPI_Formal
node run.js PF-515 --protocols 1,2 --env CAPI_BASE_DEV
```

| Flag | Description |
|------|-------------|
| `--all` | Run all linked protocols |
| `--protocols 1,3` | Run specific protocols by number or Jira key |
| `--env <name>` | Environment name (required in non-interactive mode) |
| `--assignee <id>` | Override assignee for this run |

## Jira Setup Requirements

1. **Test Protocols** must have the collection filename (ending in `.postman_collection.json`) in their Jira description
2. **Test Protocols** must be linked to a **Test Plan** via Xray's "Add Tests"
3. **Environment files** must follow the naming convention: `<Name>.postman_environment.json`

## What Gets Created

For each protocol, the script:
- Creates a **Test Execution** in Jira linked to the Test Plan
- Attaches evidence: Newman HTML report, Newman version, run metadata
- Copies labels, fix versions, components, and assignee from the Test Plan
- Transitions the issue status based on pass/fail

## Full Setup Guide

See [output/setup.md](output/setup.md) for detailed setup instructions, including troubleshooting.
