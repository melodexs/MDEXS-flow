"""Alembic environment.

Reads the SQLAlchemy URL from settings (DATABASE_URL), so migrations run
against the same configuration as the application. Versioned migration
scripts live in services/api/alembic/versions.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

url = get_settings().sqlalchemy_url
if url is None:
    raise SystemExit(
        "DATABASE_URL is not set. Alembic requires a cloud database URL; "
        "set it in .env (never commit real credentials)."
    )
config.set_main_option("sqlalchemy.url", url)

from app.database.base import Base  # noqa: E402
from app.modules import auth  # noqa: E402,F401 (registers models on the metadata)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
