"""Entry point. Picks the transport from MCP_TRANSPORT."""

from __future__ import annotations

import logging

from . import SERVER_NAME, SERVER_VERSION
from .api_client import ApiClient
from .config import load_config
from .logging_setup import configure_logging

log = logging.getLogger(__name__)


def main() -> None:
    config = load_config()
    configure_logging(config.log_level)
    api = ApiClient.from_config(config)

    if config.transport == "stdio":
        from .server import create_server

        log.info(
            "server starting",
            extra={"fields": {"name": SERVER_NAME, "version": SERVER_VERSION, "transport": "stdio"}},
        )
        create_server(api).run(transport="stdio")
        return

    import uvicorn

    from .http import create_http_app

    log.info(
        "server starting",
        extra={
            "fields": {
                "name": SERVER_NAME,
                "version": SERVER_VERSION,
                "transport": "http",
                "url": f"http://{config.http_host}:{config.http_port}{config.http_path}",
                "auth": "bearer" if config.auth_token else "none",
            }
        },
    )
    uvicorn.run(create_http_app(config, api), host=config.http_host, port=config.http_port, log_config=None)


if __name__ == "__main__":
    main()
