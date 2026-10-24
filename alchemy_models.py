from typing import Optional, List
from datetime import datetime

from sqlalchemy import create_engine, String, Integer, Float, ForeignKey, CheckConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class Operator(Base):
    """Reference list only — seeded by admin, selected by users during sighting."""
    __tablename__ = "operator"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    short_code: Mapped[Optional[str]] = mapped_column(String, unique=True)
    type: Mapped[str] = mapped_column(String, default="government")
    def __str__(self):
        return f"{self.name} ({self.short_code})" if self.short_code else self.name

class Route(Base):
    __tablename__ = "route"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(String)
    start_terminus: Mapped[str] = mapped_column(String)
    stop_terminus: Mapped[str] = mapped_column(String)
    frequency_minutes: Mapped[Optional[int]] = mapped_column(Integer)

    route_stops: Mapped[List["RouteStop"]] = relationship(back_populates="route")
    def __str__(self):
        return self.name

class Stop(Base):
    __tablename__ = "stop"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    latitude: Mapped[Optional[float]] = mapped_column(Float)
    longitude: Mapped[Optional[float]] = mapped_column(Float)
    landmark: Mapped[Optional[str]] = mapped_column(String)

    route_stops: Mapped[List["RouteStop"]] = relationship(back_populates="stop")
    def __str__(self):
        return self.name

class RouteStop(Base):
    __tablename__ = "route_stop"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("route.id"))
    stop_id: Mapped[int] = mapped_column(ForeignKey("stop.id"))
    stop_order: Mapped[int] = mapped_column(Integer)
    avg_travel_seconds: Mapped[int] = mapped_column(Integer, default=0)

    route: Mapped["Route"] = relationship(back_populates="route_stops")
    stop: Mapped["Stop"] = relationship(back_populates="route_stops")
    sightings: Mapped[List["Sighting"]] = relationship(back_populates="route_stop")

class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    firebase_uid: Mapped[Optional[str]] = mapped_column(String, unique=True)
    name: Mapped[Optional[str]] = mapped_column(String)
    phone: Mapped[Optional[str]] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    sightings: Mapped[List["Sighting"]] = relationship(back_populates="user")
    favorites: Mapped[List["UserFavorite"]] = relationship(back_populates="user", cascade="all, delete-orphan")

class UserFavorite(Base):
    __tablename__ = "user_favorite"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    route_stop_id: Mapped[int] = mapped_column(ForeignKey("route_stop.id"))
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    user: Mapped["User"] = relationship(back_populates="favorites")
    route_stop: Mapped["RouteStop"] = relationship()

class Sighting(Base):
    __tablename__ = "sighting"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    route_stop_id: Mapped[int] = mapped_column(ForeignKey("route_stop.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    operator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("operator.id"))
    seen_at: Mapped[datetime] = mapped_column(default=func.now())
    direction: Mapped[Optional[str]] = mapped_column(String)
    crowd_level: Mapped[Optional[str]] = mapped_column(String)

    __table_args__ = (
        CheckConstraint("direction IN ('forward', 'return')", name="check_direction"),
        CheckConstraint("crowd_level IN ('empty', 'moderate', 'packed')", name="check_crowd_level"),
    )

    route_stop: Mapped["RouteStop"] = relationship(back_populates="sightings")
    user: Mapped["User"] = relationship(back_populates="sightings")
    operator: Mapped[Optional["Operator"]] = relationship()

import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///transitpulse.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://") and not DATABASE_URL.startswith("postgresql+psycopg2://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
engine = create_engine(DATABASE_URL,pool_pre_ping=True,
    pool_recycle=300)
Base.metadata.create_all(engine)
