"""Thin client for the upstream API.

This is the only place that knows about base URLs, auth headers, and
timeouts. Tools call typed methods and never see credentials.

Replace the Items methods with calls to the real API you are wrapping.
"""

from __future__ import annotations

from typing import Any

import httpx
from pydantic import BaseModel, Field

from .config import Config


class ApiError(Exception):
    def __init__(self, status: int, message: str, retry_after_seconds: int | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.retry_after_seconds = retry_after_seconds


class Item(BaseModel):
    id: str
    name: str
    description: str = ""
    created_at: str = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class ItemPage(BaseModel):
    items: list[Item]
    total: int
    offset: int
    limit: int


class ApiClient:
    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        timeout_ms: int = 15_000,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        headers = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers=headers,
            timeout=httpx.Timeout(timeout_ms / 1000),
            transport=transport,
        )

    @classmethod
    def from_config(cls, config: Config, transport: httpx.AsyncBaseTransport | None = None) -> ApiClient:
        return cls(config.api_base_url, config.api_key, config.api_timeout_ms, transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    # ---- Endpoint methods. Replace these for your API. ----------------------

    async def list_items(self, query: str | None, limit: int, offset: int) -> ItemPage:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if query:
            params["q"] = query
        return ItemPage.model_validate(await self._request("GET", "/items", params=params))

    async def get_item(self, item_id: str) -> Item:
        return Item.model_validate(await self._request("GET", f"/items/{item_id}"))

    async def create_item(self, name: str, description: str | None) -> Item:
        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        return Item.model_validate(await self._request("POST", "/items", json=body))

    # ---- Transport ----------------------------------------------------------

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            res = await self._client.request(method, path, **kwargs)
        except httpx.TimeoutException as exc:
            raise ApiError(0, "timed out") from exc
        except httpx.HTTPError as exc:
            raise ApiError(0, "unreachable") from exc

        if res.is_error:
            retry_after = res.headers.get("retry-after")
            raise ApiError(
                res.status_code,
                _extract_error_message(res),
                int(retry_after) if retry_after and retry_after.isdigit() else None,
            )
        if res.status_code == 204 or not res.content:
            return None
        return res.json()


def _extract_error_message(res: httpx.Response) -> str:
    try:
        data = res.json()
    except ValueError:
        return f"HTTP {res.status_code}"
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, str):
            return err
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            return err["message"]
        if isinstance(data.get("message"), str):
            return data["message"]
    return f"HTTP {res.status_code}"
