# SPEC-001: Autonomous Performance Agency Core & Dashboard Optimization

## 1. Goal & Vision
The goal is to build an autonomous performance marketing agency module within Open Mercato. The system will handle market research, competitor analysis, campaign management, and eventually internal agency operations (accounting, client acquisition). 
The application must act as a "living system" where AI agents monitor external data (via integrations with Google Search Console, Google Ads, GA, GTM, etc.) and proactively interact with clients via their preferred communication channels (Slack, Email).

## 2. Architecture & Open Mercato Features

### 2.1. Asynchronous Deep Research
Deep market and competitor research takes time and must not block the user interface. 
*   **Implementation:** Use Open Mercato's built-in Queue system (BullMQ on Redis) for background processing [6].
*   **Workflow Engine:** Leverage the native Workflows module to orchestrate multi-step, async business processes (e.g., triggers for "New Competitor Analysis" or "Campaign Setup") [7].

### 2.2. Living Context (The Brief)
The brief is a "living document" that adapts based on new data or conversations. 
*   **Implementation:** Utilize the Custom Fields and Entities layer to model the "Brief" [1, 8]. 
*   **Command Pattern & Audit:** All AI modifications to the brief must use Open Mercato's Command Pattern, which automatically provides an audit trail, action logs, and an "undo" feature [9, 10]. If the AI detects a discrepancy (e.g., different pricing in chat vs. brief), it must emit an event, pause the workflow, and ask the user for confirmation before committing the update [1, 7].

### 2.3. Omnichannel Client Interactions (Headless)
Clients will initially have dashboard access, but the target experience is interaction via Slack/Email.
*   **Implementation:** Leverage Open Mercato's headless deployment capabilities by exposing well-typed API endpoints for Slack bots and Email webhooks [11, 12]. 
*   **AI Integration:** Use the built-in MCP (Model Context Protocol) to expose Open Mercato APIs and Entity Schemas directly to dedicated AI Agents [13, 14], allowing them to answer client status requests seamlessly via chat.

### 2.4. Data Security
Performance marketing briefs and budgets are highly confidential.
*   **Implementation:** Enable Open Mercato's tenant-scoped, field-level data encryption [15, 16]. Custom fields containing budgets, strategies, and API keys for Google integrations must be wrapped in AES-GCM encryption at the ORM lifecycle level [15].

## 3. Implementation Steps for AI Agent
1.  **Dashboard Cleanup:** Modify `src/modules.ts` to disable unused core modules.
2.  **Schema Definition:** Create a new custom module (e.g., `performance-agency`) and define the `Brief` entity with field-level encryption for sensitive data.
3.  **Queue Configuration:** Set up a Redis-based async queue worker for the deep research tasks.
4.  **MCP Tooling:** Prepare MCP tools/endpoints for Slack integration and basic Google API calls.
