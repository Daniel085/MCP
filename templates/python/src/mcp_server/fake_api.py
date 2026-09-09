"""A tiny in-memory stand-in for the upstream Items API.

Used by the tests and for trying the server locally without real credentials.

    GET  /items?q=&limit=&offset=      -> { items, total, offset, limit }
    GET  /items/{id}                   -> item | 404
    POST /items { name, description }  -> 201 item | 422

Send Authorization: Bearer bad-key to get a 401, useful for error-path demos.
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .fake_data import seed_items


def create_fake_api() -> Starlette:
    items = seed_items()

    def unauthorized(request: Request) -> JSONResponse | None:
        if request.headers.get("authorization") == "Bearer bad-key":
            return JSONResponse({"error": {"message": "invalid api key"}}, status_code=401)
        return None

    async def list_items(request: Request) -> JSONResponse:
        if (err := unauthorized(request)) is not None:
            return err
        q = request.query_params.get("q", "").lower()
        limit = min(int(request.query_params.get("limit", 10)), 100)
        offset = int(request.query_params.get("offset", 0))
        matched = (
            [i for i in items if q in i["name"].lower() or q in i["description"].lower()] if q else items
        )
        return JSONResponse(
            {
                "items": matched[offset : offset + limit],
                "total": len(matched),
                "offset": offset,
                "limit": limit,
            }
        )

    async def get_item(request: Request) -> JSONResponse:
        if (err := unauthorized(request)) is not None:
            return err
        item_id = request.path_params["id"]
        for item in items:
            if item["id"] == item_id:
                return JSONResponse(item)
        return JSONResponse({"error": {"message": f"item {item_id} does not exist"}}, status_code=404)

    async def create_item(request: Request) -> JSONResponse:
        if (err := unauthorized(request)) is not None:
            return err
        body = await request.json()
        name = body.get("name") if isinstance(body, dict) else None
        if not isinstance(name, str) or not name:
            return JSONResponse({"error": {"message": "name is required"}}, status_code=422)
        item = {
            "id": f"itm_{len(items) + 1}",
            "name": name,
            "description": body.get("description") or "",
            "createdAt": datetime.now(UTC).isoformat(),
        }
        items.append(item)
        return JSONResponse(item, status_code=201)

    return Starlette(
        routes=[
            Route("/items", list_items, methods=["GET"]),
            Route("/items", create_item, methods=["POST"]),
            Route("/items/{id}", get_item, methods=["GET"]),
        ]
    )


def main() -> None:
    import uvicorn

    port = int(os.environ.get("FAKE_API_PORT", "4010"))
    print(f"fake items api listening on http://127.0.0.1:{port}", file=sys.stderr)
    uvicorn.run(create_fake_api(), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
