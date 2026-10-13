# 🚌 TransitPulse

> **Crowdsourced Real-Time Transit Sighting & Predictive ETA Engine**  
> A lightweight, zero-hardware transit intelligence platform designed for suburban and regional bus corridors.

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.x-lightgrey.svg)](https://flask.palletsprojects.com/)
[![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0%20ORM-red.svg)](https://www.sqlalchemy.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon%20Serverless-00e699.svg)](https://neon.tech/)
[![PWA](https://img.shields.io/badge/Frontend-Progressive%20Web%20App-purple.svg)]()

---

## 📌 Overview

Public bus transit across suburban corridors (e.g., Hapur–Ghaziabad–Delhi) frequently suffers from an absence of live telemetry. Conventional fleet tracking requires expensive Automatic Vehicle Location (AVL) GPS hardware, which is economically unfeasible for small municipal and private bus fleets.

**TransitPulse** solves this challenge through a participatory computing model:
- Commuters at bus stops or inside vehicles submit verified transit observations (*"I see the bus"*).
- Each observation captures the transit waypoint, operator tag (UPSRTC, DTC, HRTC, Private), and crowd density level (*Empty, Moderate, Packed*).
- An algorithmic predictive ETA engine dynamically computes remaining journey duration across sequential corridor segments, displaying a real-time ticking countdown to waiting passengers.

---

## 🛠️ Tech Stack & Architecture

- **Backend Framework:** Python Flask (RESTful routing, CORS handling, single-port static asset serving).
- **ORM & Data Layer:** SQLAlchemy 2.0 (DeclarativeBase, strictly typed `Mapped[T]` columns, bidirectional relationships).
- **Production Database:** Serverless PostgreSQL on [Neon](https://neon.tech) (AWS Singapore region).
- **Authentication:** Firebase Web & Admin SDK (Cryptographic Phone OTP verification with JWT Bearer tokens).
- **Administration:** Flask-Admin with session-guarded views and thread-safe `scoped_session` lifecycles.
- **Frontend / Client:** Semantic HTML5, modern CSS3 dark shell, vanilla ES6+ JavaScript (Zero-framework, low overhead).
- **Progressive Web App (PWA):** Web Manifest (`manifest.webmanifest`) and Service Worker (`sw.js`) for standalone home-screen installation and offline static asset caching.

---

## 📁 Repository Structure

```text
├── frontend/                     # Client application (PWA)
│   ├── index.html                # Landing hero page
│   ├── routes.html               # Route discovery & starred explorer
│   ├── stops.html                # Sequential waypoints & live ETA board
│   ├── register.html             # Phone OTP verification portal
│   ├── starred.html              # Pinned commuter favorites
│   ├── style.css                 # Dark theme design system
│   ├── api.js                    # Async API client
│   ├── sw.js                     # PWA Service Worker (Cache management)
│   ├── manifest.webmanifest      # PWA App Manifest
│   └── favicon.svg               # Vector brand icon
├── admin_views.py                # Protected Flask-Admin dashboard views
├── alchemy_models.py             # SQLAlchemy 2.0 database models
├── app.py                        # Application entry point & RESTful API routes
├── auth_middleware.py            # Firebase token verification & anti-spam filter
├── db.py                         # SQLAlchemy session factory
├── eta.py                        # Segment-by-segment predictive ETA engine
├── requirements.txt              # Production dependency specifications
└── README.md                     # Project documentation
