"""auth tables: users, user_identities, refresh_sessions

Revision ID: 0001_auth
Revises: (base)
Create Date: 2026-10-18

Email/password auth + Google identity linking + revocable refresh sessions.
Password hashes are bcrypt; refresh tokens are stored only as SHA-256
hashes (see app/core/security.py).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_auth"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=80), nullable=False),
        sa.Column(
            "status",
            sa.Enum("active", "suspended", name="account_status"),
            nullable=False,
            server_default="active",
        ),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "user_identities",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("provider_subject", sa.String(length=255), nullable=False),
        sa.Column("provider_email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.UniqueConstraint("provider", "provider_subject", name="uq_provider_subject"),
    )
    op.create_index("ix_user_identities_user", "user_identities", ["user_id"])

    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rotated_from_id", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_refresh_sessions_user", "refresh_sessions", ["user_id"])
    op.create_index("ix_refresh_sessions_token_hash", "refresh_sessions", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_refresh_sessions_token_hash", table_name="refresh_sessions")
    op.drop_index("ix_refresh_sessions_user", table_name="refresh_sessions")
    op.drop_table("refresh_sessions")
    op.drop_index("ix_user_identities_user", table_name="user_identities")
    op.drop_table("user_identities")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
