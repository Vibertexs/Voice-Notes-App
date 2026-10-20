"""Client ID Metadata Documents: an assistant identified by a URL it publishes.

Instead of registering with this server first, a client may use an https URL as its
client id. The URL serves a small JSON document naming the client and listing the
redirect URIs it will use, and this server fetches it. That makes this the one place
the server makes a request to an address a stranger chose, so it is strict:

  - https only, on the default port, no credentials in the URL, a path, no fragment
  - the host must resolve only to public addresses: nothing loopback, private,
    link-local, or otherwise internal (the classic server-side request forgery)
  - the connection goes to the address that was checked, not to a second lookup of
    the name, so the answer cannot change between the check and the connection
  - no redirects, a few seconds, a few kilobytes
  - the document must name itself: its client_id has to be exactly the URL it was
    fetched from, or anyone could publish a document claiming to be someone else
"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
from typing import Any
from urllib.parse import urlsplit

import httpx

MAX_URL = 512
MAX_BYTES = 10_000
TIMEOUT_SECONDS = 5.0


class ClientMetadataError(Exception):
    """The document could not be used. The message is safe to show a person."""


def check_url(client_id: str) -> tuple[str, str]:
    """(host, path-and-query) for a client id that may be fetched, or raise."""
    if len(client_id) > MAX_URL:
        raise ClientMetadataError("That client address is too long.")
    parts = urlsplit(client_id)
    if parts.scheme != "https" or not parts.hostname:
        raise ClientMetadataError("A client address must be an https URL.")
    if parts.username or parts.password or parts.fragment:
        raise ClientMetadataError("A client address cannot contain credentials or a fragment.")
    if parts.port not in (None, 443):
        raise ClientMetadataError("A client address must use the standard https port.")
    if parts.path in ("", "/"):
        raise ClientMetadataError("A client address must have a path.")
    host = parts.hostname.lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ClientMetadataError("A client address must use a name, not an IP address.")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise ClientMetadataError("A client address must be on the public internet.")
    return host, parts.path + (f"?{parts.query}" if parts.query else "")


async def public_address(host: str) -> str:
    """The first address the name resolves to, if every address it resolves to is public."""
    try:
        found = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise ClientMetadataError("That client address could not be found.") from None
    addresses = [item[4][0] for item in found]
    if not addresses:
        raise ClientMetadataError("That client address could not be found.")
    for address in addresses:
        if not ipaddress.ip_address(address.split("%")[0]).is_global:
            raise ClientMetadataError("A client address must be on the public internet.")
    return addresses[0]


def parse(client_id: str, document: Any) -> dict[str, Any]:
    """Validate the document and keep only what this server uses."""
    if not isinstance(document, dict):
        raise ClientMetadataError("The client's metadata is not a JSON object.")
    if document.get("client_id") != client_id:
        raise ClientMetadataError("The client's metadata does not name itself.")
    uris = document.get("redirect_uris")
    if not isinstance(uris, list) or not uris or not all(isinstance(uri, str) for uri in uris):
        raise ClientMetadataError("The client's metadata has no redirect_uris.")
    # Only public clients: a client secret in a document anyone can read would be no secret.
    if document.get("token_endpoint_auth_method", "none") != "none" or "client_secret" in document:
        raise ClientMetadataError("A client published by address cannot use a client secret.")
    name = document.get("client_name")
    return {"client_name": name if isinstance(name, str) else None, "redirect_uris": uris}


async def fetch(client_id: str) -> dict[str, Any]:
    """The client's metadata, fetched safely. Raises ClientMetadataError for anything unusable."""
    host, target = check_url(client_id)
    address = await public_address(host)
    literal = f"[{address}]" if ":" in address else address
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False) as http:
            # Connect to the address that was checked; say the name for the Host header and for
            # TLS, so the certificate is still verified against the client's own name.
            async with http.stream(
                "GET", f"https://{literal}{target}", headers={"Host": host, "Accept": "application/json"},
                extensions={"sni_hostname": host},
            ) as response:
                if response.status_code != 200:
                    raise ClientMetadataError("The client's metadata could not be fetched.")
                body = b""
                async for piece in response.aiter_bytes():
                    body += piece
                    if len(body) > MAX_BYTES:
                        raise ClientMetadataError("The client's metadata is too large.")
    except httpx.HTTPError:
        raise ClientMetadataError("The client's metadata could not be fetched.") from None
    try:
        document = json.loads(body)
    except ValueError:
        raise ClientMetadataError("The client's metadata is not valid JSON.") from None
    return parse(client_id, document)
