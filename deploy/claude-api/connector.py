"""Call tools on a remote MCP server from a Messages API request."""

import os

from anthropic import Anthropic

client = Anthropic()  # reads ANTHROPIC_API_KEY or the active `ant auth login` profile

server_url = os.environ["MCP_SERVER_URL"]
auth_token = os.environ.get("MCP_AUTH_TOKEN")

mcp_server = {"type": "url", "url": server_url, "name": "items"}
if auth_token:
    mcp_server["authorization_token"] = auth_token

with client.beta.messages.stream(
    model="claude-opus-5",
    max_tokens=16000,
    thinking={"type": "adaptive"},
    betas=["mcp-client-2025-11-20", "server-side-fallback-2026-07-01"],
    fallbacks="default",
    mcp_servers=[mcp_server],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "items"}],
    messages=[{"role": "user", "content": "List the first three items, then fetch the second one by id."}],
) as stream:
    response = stream.get_final_message()

if response.stop_reason == "refusal":
    print("refused:", response.stop_details)
else:
    for block in response.content:
        if block.type == "text":
            print(block.text)
