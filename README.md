<p align="center">
  <img src="devpost-thumbnail.png" alt="CodeSentinel" width="680" />
</p>

<h1 align="center">CodeSentinel</h1>

<p align="center">
  <strong>AI-Powered Codebase Health Agent for Slack</strong>
</p>

<p align="center">
  Detect dead code, circular dependencies, coupling issues, and architectural drift — all without leaving Slack.
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-mcp-server">MCP Server</a> •
  <a href="#%EF%B8%8F-demo">Demo</a> •
  <a href="#-slack-hackathon">Hackathon</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Slack-Agent_Builder-4A154B?logo=slack&logoColor=white" alt="Slack Agent Builder" />
  <img src="https://img.shields.io/badge/MCP-Protocol-00C4B4?logo=modelcontextprotocol&logoColor=white" alt="MCP" />
  <img src="https://img.shields.io/badge/Bolt-Node.js-3A86FF?logo=slack&logoColor=white" alt="Bolt" />
  <img src="https://img.shields.io/badge/Block_Kit-Rich_UI-E01E5A?logo=slack&logoColor=white" alt="Block Kit" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" />
  <img src="https://img.shields.io/badge/Hackathon-Slack_Agent_Builder_Challenge-orange" alt="Hackathon" />
</p>

---

## What is CodeSentinel?

CodeSentinel is a **Slack AI agent** that analyzes your codebase for common health problems and surfaces the results with rich, actionable **Block Kit** visualizations directly in Slack. It combines **Slack AI capabilities** with a standalone **MCP (Model Context Protocol) server** so the same analysis tools work everywhere — Slack, Claude Desktop, Cursor, or any MCP-compatible client.

**The problem it solves:** Dead code, circular dependencies, excessive coupling, and architectural drift are invisible in day-to-day work. Static analysis tools produce noise in CI dashboards nobody checks. CodeSentinel brings these insights into the place where teams already discuss and act on code quality: **Slack**.

## ✨ Features

### 🔍 Dead Code Detection
Find functions, classes, modules, and exports that are defined but never referenced anywhere. Each finding includes:
- Exact file path and line number
- Severity classification (critical / warning / info)
- Explanation of why the code is dead
- Specific fix suggestion

### 🔁 Circular Dependency Detection
DFS-based cycle detection across module imports. Shows:
- The exact import cycle as a file path chain
- Impact assessment (tree-shaking, init-order bugs, testability)
- Remediation strategy (extract shared module, DI, events)

### 📊 Coupling Metrics
Measures fan-out per module and identifies tightly coupled clusters. Reports:
- Per-module dependency count vs. configurable threshold
- Full dependency list for high-fan-out modules
- Coupling score for detected clusters
- Refactoring suggestions (Facade, DIP, events)

### 🏗️ Architectural Drift Detection
Checks for layer boundary violations. Detects:
- UI → Data direct imports (bypassing service layer)
- Business → UI reverse dependencies
- Data → Business circular layer deps
- Shared layer breaching (config importing from services)
- Architecture compliance percentage

### 🩺 Full Health Scan
Runs all four analyses and computes:
- **Overall health score** (0–100) with letter grade (A–D)
- Category breakdown with finding counts
- Prioritized top-5 action items
- AI-generated executive summary

### 🧠 AI-Powered Summaries
Uses Deepseek / OpenAI / Anthropic to generate:
- 3–5 sentence executive summaries of analysis results
- Prioritized recommendations
- Detailed explanations of any finding (via MCP tool)

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        SLACK                            │
│  ┌────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │  Assistant  │  │  Block Kit    │  │   Suggested   │   │
│  │  View       │  │  Rich UI      │  │   Prompts     │   │
│  └─────┬──────┘  └──────▲────────┘  └──────┬────────┘   │
│        │                │                   │            │
│  ══════╪════════════════╪═══════════════════╪══════      │
│        ▼                │                   ▼            │
│  ┌──────────────────────────────────────────────────┐    │
│  │            BOLT FOR NODE.JS APP                  │    │
│  │                                                   │    │
│  │  ┌──────────────┐    ┌────────────────────────┐   │    │
│  │  │   Intent     │    │    Analysis Engine     │   │    │
│  │  │   Parser     │───▶│  ┌──────────────────┐  │   │    │
│  │  │  (NLP route) │    │  │  Dead Code       │  │   │    │
│  │  └──────────────┘    │  │  Circular Deps   │  │   │    │
│  │                      │  │  Coupling        │  │   │    │
│  │  ┌──────────────┐    │  │  Drift           │  │   │    │
│  │  │  LLM Provider│    │  └──────────────────┘  │   │    │
│  │  │  (Deepseek/  │    └───────────┬────────────┘   │    │
│  │  │   OpenAI/    │                │                 │    │
│  │  │   Anthropic) │                │                 │    │
│  │  └──────────────┘                │                 │    │
│  └──────────────────────────────────┼─────────────────┘    │
│                                     │                      │
│  ───────────────────────────────────┼───────────────────    │
│                                     ▼                      │
│  ┌──────────────────────────────────────────────────┐     │
│  │              MCP SERVER (stdio)                  │     │
│  │                                                   │     │
│  │  🔧 analyze_dead_code                            │     │
│  │  🔧 detect_circular_deps                         │     │
│  │  🔧 analyze_coupling                             │     │
│  │  🔧 detect_architectural_drift                   │     │
│  │  🔧 full_health_scan                             │     │
│  │  🔧 explain_finding                              │     │
│  │                                                   │     │
│  │  Works with: Claude Desktop, Cursor, Windsurf,   │     │
│  │  any MCP-compatible client                       │     │
│  └──────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+
- **Slack Developer Program** sandbox workspace
- **Deepseek API key** (or OpenAI / Anthropic)

### 1. Create the Slack App

1. Go to [api.slack.com/apps/new](https://api.slack.com/apps/new) → **"From a manifest"**
2. Select your sandbox workspace
3. Paste the contents of [`manifest.json`](manifest.json)
4. Click **Review → Install**

### 2. Enable Agent Builder

1. In the app settings sidebar, find **Agents & AI Apps**
2. Toggle **Agent Builder** on
3. Optionally enable **Model Context Protocol** under the same section

### 3. Get Your Tokens

- **Bot Token**: *OAuth & Permissions* → copy `Bot User OAuth Token`
- **App Token**: *Basic Information* → *App-Level Tokens* → create one with `connections:write`

### 4. Install & Run

```bash
git clone https://github.com/icohangar-ops/codesentinel.git
cd codesentinel
npm install
cp .env.sample .env
# Edit .env with your tokens and API key
npm start
```

### 5. Use It

Open Slack → find **CodeSentinel** in the sidebar → pick a suggested prompt or type a message:

```
Run a full health scan on https://github.com/org/repo
```

```
Check coupling metrics in our frontend
```

```
Find circular dependencies
```

## 🔌 MCP Server

CodeSentinel ships a standalone **MCP server** that exposes the same 6 analysis tools to any MCP-compatible client — not just Slack.

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codesentinel": {
      "command": "node",
      "args": ["/absolute/path/to/codesentinel/mcp-server/index.js"]
    }
  }
}
```

### Cursor / Windsurf

Add to your MCP settings:

```json
{
  "mcpServers": {
    "codesentinel": {
      "command": "node",
      "args": ["/absolute/path/to/codesentinel/mcp-server/index.js"]
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `analyze_dead_code` | Find unused functions, classes, and modules |
| `detect_circular_deps` | Find module import cycles via DFS |
| `analyze_coupling` | Measure fan-out and identify tight clusters |
| `detect_architectural_drift` | Check layer boundary violations |
| `full_health_scan` | Complete analysis with 0–100 health score |
| `explain_finding` | AI-powered detailed explanation of any finding |

## 📁 Project Structure

```
codesentinel/
├── app.js                              # Bolt app entry point (Socket Mode)
├── manifest.json                       # Slack app manifest
├── package.json
├── .env.sample                         # Environment variable template
├── .gitignore
│
├── listeners/
│   ├── assistant/
│   │   ├── assistant_thread_started.js # Welcome + suggested prompts
│   │   ├── message.js                  # Main analysis request handler
│   │   └── llm-caller.js               # Streaming support (Thinking Steps)
│   └── events/
│       └── app_mention.js              # @CodeSentinel handler
│
├── lib/
│   ├── analysis-engine.js              # Analysis orchestrator + health score
│   ├── intent-parser.js                # NLP intent classification
│   ├── block-kit-builder.js            # Rich Slack Block Kit UI builder
│   ├── llm-provider.js                 # Multi-provider LLM (Deepseek/OpenAI/Anthropic)
│   ├── slack-helpers.js                # Slack API utilities
│   ├── repo-fetcher.js                 # GitHub/GitLab repo metadata
│   └── analyzers/
│       ├── dead-code.js                # Dead code detector
│       ├── circular-deps.js            # Cycle detection (DFS)
│       ├── coupling.js                 # Fan-out & cluster analysis
│       └── drift.js                    # Layer boundary violations
│
├── mcp-server/
│   ├── index.js                        # MCP server with 6 tools
│   └── package.json
│
├── functions/
│   └── analyze_health/
│       └── definition.json             # Slack function definition
│
├── architecture-diagram.png            # System architecture visual
├── devpost-thumbnail.png               # Hackathon submission thumbnail
├── demo-script.md                      # 3-minute demo video script
├── devpost-submission.md               # Devpost submission content
└── README.md                           # This file
```

## 🎥 Demo

See [`demo-script.md`](demo-script.md) for the full 3-minute demo video narration script covering:

1. **Problem Statement** (0:00–0:30) — Invisible code health problems
2. **Introducing CodeSentinel** (0:30–1:00) — Agent overview + tech stack
3. **Live Demo: Dead Code Scan** (1:00–1:30) — Real Block Kit response
4. **Live Demo: Full Health Scan** (1:30–2:00) — Health score + categories
5. **MCP Integration** (2:00–2:30) — Claude Desktop + Cursor usage
6. **Impact & Closing** (2:30–3:00) — Why this matters

## 🏆 Slack Hackathon

**Challenge:** [Slack Agent Builder Challenge](https://slackhack.devpost.com/) ($42,000 prizes)

**Track:** New Slack Agent

**Technologies Used (all 3 required):**

| Technology | Implementation |
|---|---|
| **Slack AI capabilities** | Agent Builder, assistant view, suggested prompts, Block Kit, thread-based conversations |
| **MCP server integration** | 6 analysis tools via Model Context Protocol, usable by any MCP client |
| **Real-Time Search API** | Context-aware repo URL discovery from workspace messages |

**Judging Criteria:**
- ✅ **Technological Implementation** — Clean Bolt.js app, modular analyzer architecture, MCP protocol compliance
- ✅ **Design** — Rich Block Kit UI, severity-coded findings, health scores, actionable suggestions
- ✅ **Potential Impact** — Solves a universal engineering pain point, works across any codebase
- ✅ **Quality of Idea** — First agent to bring code health analysis natively into Slack

## 🔧 Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token (starts with `xoxb-`) |
| `SLACK_APP_TOKEN` | Yes* | App-Level Token with `connections:write` scope (starts with `xapp-`) |
| `SLACK_SIGNING_SECRET` | No | For HTTP mode (not needed with Socket Mode) |
| `LLM_PROVIDER` | No | `deepseek` (default), `openai`, or `anthropic` |
| `DEEPSEEK_API_KEY` | Yes* | Deepseek API key (if using Deepseek) |
| `OPENAI_API_KEY` | Yes* | OpenAI API key (if using OpenAI) |
| `PORT` | No | Server port (default: 3000) |

\* At least one LLM API key is required. App token required for Socket Mode.

### Custom Analyzers

Each analyzer in `lib/analyzers/` follows a simple interface:

```javascript
function analyze(repoInfo) {
  return {
    type: "your_analysis_type",
    description: "Human-readable description",
    findings: [
      {
        type: "finding_type",
        severity: "critical" | "warning" | "info",
        file: "path/to/file.ts",
        line: 42,
        name: "symbol_name",
        reason: "Why this is a problem",
        suggestion: "How to fix it",
      },
    ],
    stats: { /* summary metrics */ },
    timestamp: new Date().toISOString(),
    repo: repoInfo?.url || "workspace",
  };
}
```

Add a new analyzer, register it in `analysis-engine.js`, and it's automatically available in Slack and via MCP.

## 🗺 Roadmap

- [ ] **Real AST analysis** — ts-morph for TypeScript, tree-sitter for multi-language support
- [ ] **GitHub App** — Automatic analysis on PRs with inline comments
- [ ] **Historical trends** — Track health score over time per repo
- [ ] **Custom architecture rules** — Define layer boundaries via Slack commands
- [ ] **Team dashboards** — Aggregate health in Slack Canvas
- [ ] **Webhook integrations** — Trigger scans on Git push events

## 📄 License

MIT © 2026

---

<p align="center">
  Built for the <a href="https://slackhack.devpost.com/">Slack Agent Builder Challenge</a> •
  Powered by <a href="https://api.slack.com/tools/bolt">Bolt for Node.js</a> +
  <a href="https://modelcontextprotocol.io">MCP</a> +
  <a href="https://api.slack.com/ai">Slack AI</a>
</p>