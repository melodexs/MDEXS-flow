"""Declarative base for all ORM models.

Alembic reads this metadata (see alembic/env.py). Importing the models
package ensures every model is registered on the metadata.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all MDEXS Flow ORM models."""
