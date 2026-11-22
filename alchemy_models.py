from typing import Optional, List
from datetime import datetime

from sqlalchemy import create_engine, String, Integer, Float, Boolean, ForeignKey, CheckConstraint, func, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class Operator(Base):
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
    distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    is_waypoint: Mapped[bool] = mapped_column(Boolean, default=False)

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

class PredictionLog(Base):
    __tablename__ = "prediction_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    route_stop_id: Mapped[int] = mapped_column(ForeignKey("route_stop.id"))
    direction: Mapped[str] = mapped_column(String)
    predicted_eta_minutes: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String)
    predicted_at: Mapped[datetime] = mapped_column(default=func.now())
    actual_arrival_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    error_minutes: Mapped[Optional[float]] = mapped_column(default=None)

class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("user.id"), default=None)
    category: Mapped[str] = mapped_column(String)
    message: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

class Sighting(Base):
    __tablename__ = "sighting"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    route_stop_id: Mapped[int] = mapped_column(ForeignKey("route_stop.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"))
    operator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("operator.id"))
    seen_at: Mapped[datetime] = mapped_column(default=func.now())
    direction: Mapped[Optional[str]] = mapped_column(String)
    crowd_level: Mapped[Optional[str]] = mapped_column(String)
    service_type: Mapped[Optional[str]] = mapped_column(String, default=None)
    is_trip_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        CheckConstraint("direction IN ('forward', 'return')", name="check_direction"),
        CheckConstraint("crowd_level IN ('empty', 'moderate', 'packed')", name="check_crowd_level"),
    )

    route_stop: Mapped["RouteStop"] = relationship(back_populates="sightings")
    user: Mapped["User"] = relationship(back_populates="sightings")
    operator: Mapped[Optional["Operator"]] = relationship()

class PosterScan(Base):
    __tablename__ = "poster_scan"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    src: Mapped[str] = mapped_column(String, default="poster")
    scanned_at: Mapped[datetime] = mapped_column(default=func.now())
    user_agent: Mapped[Optional[str]] = mapped_column(String)

import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///transitpulse.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://") and not DATABASE_URL.startswith("postgresql+psycopg2://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
engine_kwargs = {"pool_pre_ping": True, "pool_recycle": 300}
if not DATABASE_URL.startswith("sqlite"):
    engine_kwargs.update({"pool_size": 3, "max_overflow": 2, "pool_timeout": 30})
engine = create_engine(DATABASE_URL, **engine_kwargs)
Base.metadata.create_all(engine)

def ensure_schema_columns(target_engine):
    inspector = inspect(target_engine)
    is_sqlite = target_engine.dialect.name == "sqlite"
    with target_engine.begin() as conn:
        if inspector.has_table("route_stop"):
            rs_cols = {c["name"] for c in inspector.get_columns("route_stop")}
            if "distance_km" not in rs_cols:
                col_type = "REAL DEFAULT 0.0" if is_sqlite else "DOUBLE PRECISION DEFAULT 0.0"
                conn.execute(text(f"ALTER TABLE route_stop ADD COLUMN distance_km {col_type}"))
            if "is_waypoint" not in rs_cols:
                col_type = "BOOLEAN DEFAULT 0" if is_sqlite else "BOOLEAN DEFAULT FALSE"
                conn.execute(text(f"ALTER TABLE route_stop ADD COLUMN is_waypoint {col_type}"))
        if inspector.has_table("sighting"):
            s_cols = {c["name"] for c in inspector.get_columns("sighting")}
            if "operator_id" not in s_cols:
                conn.execute(text("ALTER TABLE sighting ADD COLUMN operator_id INTEGER"))
            if "crowd_level" not in s_cols:
                conn.execute(text("ALTER TABLE sighting ADD COLUMN crowd_level VARCHAR"))
            if "service_type" not in s_cols:
                conn.execute(text("ALTER TABLE sighting ADD COLUMN service_type VARCHAR"))
            if "is_trip_confirmation" not in s_cols:
                col_type = "BOOLEAN DEFAULT 0" if is_sqlite else "BOOLEAN DEFAULT FALSE"
                conn.execute(text(f"ALTER TABLE sighting ADD COLUMN is_trip_confirmation {col_type}"))
        if inspector.has_table("user"):
            u_cols = {c["name"] for c in inspector.get_columns("user")}
            if "firebase_uid" not in u_cols:
                conn.execute(text("ALTER TABLE user ADD COLUMN firebase_uid VARCHAR"))

ensure_schema_columns(engine)
