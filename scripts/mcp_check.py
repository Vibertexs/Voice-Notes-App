"""Connect to the Ekho MCP server the way an assistant does, and try it.

    python scripts/mcp_check.py https://your-server/mcp vft_yourtoken [search words]

Uses the official MCP client, so if this works, a real assistant can connect.
Read-only: it lists the tools, then calls list_folders, list_recordings and
(optionally) search_lectures. Makes a token in the app first: person icon >
Assistants.
"""
import asyncio
import json
import sys

import httpx2
from mcp.client import Client
from mcp.client.streamable_http import streamable_http_client


def show(label: str, result) -> None:
    text = result.content[0].text if result.content else ""
    print(f"\n--- {label}{'  (ERROR)' if result.is_error else ''}")
    try:
        print(json.dumps(json.loads(text), indent=2, ensure_ascii=False)[:1500])
    except ValueError:
        print(text[:1500])


async def main(url: str, token: str, query: str | None) -> int:
    http = httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=30)
    async with http, Client(streamable_http_client(url, http_client=http)) as client:
        print("connected:", client.server_info.name if client.server_info else "?")
        tools = await client.list_tools()
        print("tools:", ", ".join(t.name for t in tools.tools))
        show("list_folders", await client.call_tool("list_folders", {}))
        show("list_recordings", await client.call_tool("list_recordings", {"limit": 3}))
        if query:
            show(f"search_lectures({query!r})", await client.call_tool("search_lectures", {"query": query, "limit": 3}))
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    sys.exit(asyncio.run(main(sys.argv[1], sys.argv[2], " ".join(sys.argv[3:]) or None)))
