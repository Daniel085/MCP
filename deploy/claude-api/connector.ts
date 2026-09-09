// Call tools on a remote MCP server from a Messages API request.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY or the active `ant auth login` profile

const serverUrl = process.env.MCP_SERVER_URL!;
const authToken = process.env.MCP_AUTH_TOKEN;

const response = await client.beta.messages
  .stream({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    betas: ["mcp-client-2025-11-20", "server-side-fallback-2026-07-01"],
    fallbacks: "default",
    mcp_servers: [{ type: "url", url: serverUrl, name: "items", ...(authToken ? { authorization_token: authToken } : {}) }],
    tools: [{ type: "mcp_toolset", mcp_server_name: "items" }],
    messages: [{ role: "user", content: "List the first three items, then fetch the second one by id." }],
  })
  .finalMessage();

if (response.stop_reason === "refusal") {
  console.log("refused:", response.stop_details);
} else {
  for (const block of response.content) {
    if (block.type === "text") console.log(block.text);
  }
}
