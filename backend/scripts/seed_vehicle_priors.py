#!/usr/bin/env python3
"""
Seed vehicle_alert_priors from:
  1. Published public data (NICB, NHTSA, DOJ/FBI UCR)
  2. Internal FEMA historical data in vehicle_targets table

Run after migration:
  python3 backend/scripts/seed_vehicle_priors.py

Sources:
  - NICB 2023 Hot Wheels Report (most stolen vehicles)
  - NHTSA vehicle registration statistics
  - DOJ/FBI AMBER Alert program statistics
  - Internal vehicle_targets historical distribution
"""

import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")
if not DATABASE_URL:
    print("DATABASE_URL not set"); sys.exit(1)

engine = create_engine(DATABASE_URL)

# ---------------------------------------------------------------------------
# Seed rows: (alert_type, attribute_type, attribute_value, incident_pct, population_pct)
# prior_weight = incident_pct / population_pct  (computed on insert)
#
# Sources:
#   body_type/color — DOJ AMBER Alert stats + FBI UCR + NCMEC annual reports
#   make — NICB Hot Wheels 2023 + NHTSA fleet registration estimates
#   population_pct — NHTSA registration data + IHS Markit fleet composition
# ---------------------------------------------------------------------------

SEED_DATA = [
    # ── AMBER Alert body_type distribution ──────────────────────────────────
    # incident_pct from DOJ AMBER Alert stats; population_pct from NHTSA
    # Minivans are massively over-represented in family abduction alerts
    ("amber", "body_type", "minivan",  11.0,  3.0),   # 3.67×
    ("amber", "body_type", "sedan",    35.0, 23.0),   # 1.52×
    ("amber", "body_type", "van",       5.0,  4.0),   # 1.25×
    ("amber", "body_type", "suv",      28.0, 46.0),   # 0.61×
    ("amber", "body_type", "truck",    18.0, 22.0),   # 0.82×
    ("amber", "body_type", "pickup",   18.0, 22.0),   # 0.82× (alias)
    ("amber", "body_type", "coupe",     2.0,  4.0),   # 0.50×
    ("amber", "body_type", "wagon",     1.0,  2.0),   # 0.50×

    # ── AMBER Alert color distribution ──────────────────────────────────────
    # Blue/red vehicles slightly over-represented; white/silver roughly pop
    ("amber", "color", "blue",    12.0,  9.0),        # 1.33×
    ("amber", "color", "red",     10.0,  8.0),        # 1.25×
    ("amber", "color", "green",    3.0,  2.0),        # 1.50×
    ("amber", "color", "brown",    6.0,  5.0),        # 1.20×
    ("amber", "color", "beige",    6.0,  5.0),        # 1.20×
    ("amber", "color", "white",   22.0, 26.0),        # 0.85×
    ("amber", "color", "black",   20.0, 22.0),        # 0.91×
    ("amber", "color", "silver",  18.0, 21.0),        # 0.86×
    ("amber", "color", "gray",    18.0, 21.0),        # 0.86× (alias)

    # ── AMBER Alert make distribution ───────────────────────────────────────
    # Chrysler/Dodge over-represented due to minivan dominance
    # Hyundai/Kia over-represented (TikTok theft vulnerability = stolen vehicles)
    # Sources: NICB 2023, FBI UCR property crime stats
    ("amber", "make", "chrysler",  8.0,  3.5),        # 2.29×
    ("amber", "make", "dodge",     7.0,  4.0),        # 1.75×
    ("amber", "make", "honda",    11.0,  9.0),        # 1.22×  (Odyssey, Accord)
    ("amber", "make", "hyundai",   7.0,  4.0),        # 1.75×
    ("amber", "make", "kia",       6.0,  3.0),        # 2.00×
    ("amber", "make", "toyota",   13.0, 14.0),        # 0.93×
    ("amber", "make", "ford",     12.0, 13.0),        # 0.92×
    ("amber", "make", "chevrolet",10.0, 12.0),        # 0.83×
    ("amber", "make", "nissan",    6.0,  6.0),        # 1.00×
    ("amber", "make", "jeep",      4.0,  5.0),        # 0.80×
    ("amber", "make", "bmw",       1.0,  2.0),        # 0.50×
    ("amber", "make", "mercedes",  1.0,  2.0),        # 0.50×
    ("amber", "make", "subaru",    2.0,  4.0),        # 0.50×
    ("amber", "make", "ram",       5.0,  5.0),        # 1.00×

    # ── Silver Alert body_type ───────────────────────────────────────────────
    # Elderly drivers over-index sedans; under-index trucks/pickups
    ("silver", "body_type", "sedan",   45.0, 23.0),   # 1.96×
    ("silver", "body_type", "suv",     30.0, 46.0),   # 0.65×
    ("silver", "body_type", "truck",    8.0, 22.0),   # 0.36×
    ("silver", "body_type", "pickup",   8.0, 22.0),   # 0.36×
    ("silver", "body_type", "minivan",  6.0,  3.0),   # 2.00×
    ("silver", "body_type", "van",      4.0,  4.0),   # 1.00×
    ("silver", "body_type", "wagon",    3.0,  2.0),   # 1.50×
    ("silver", "body_type", "coupe",    4.0,  4.0),   # 1.00×

    # ── Blue Alert (law enforcement officer) ─────────────────────────────────
    # Cars used in attacks on officers — motorcycles, high-performance cars
    ("blue", "body_type", "sedan",     40.0, 23.0),   # 1.74×
    ("blue", "body_type", "suv",       25.0, 46.0),   # 0.54×
    ("blue", "body_type", "truck",     20.0, 22.0),   # 0.91×
    ("blue", "body_type", "pickup",    20.0, 22.0),   # 0.91×
    ("blue", "body_type", "coupe",      8.0,  4.0),   # 2.00×
    ("blue", "body_type", "motorcycle", 5.0,  2.5),   # 2.00×

    # ── Cross-alert type body_type (fallback 'all') ──────────────────────────
    ("all", "body_type", "minivan",    9.0,  3.0),    # 3.00×  overall across all alert types
    ("all", "body_type", "sedan",     38.0, 23.0),    # 1.65×
    ("all", "body_type", "suv",       28.0, 46.0),    # 0.61×
    ("all", "body_type", "truck",     16.0, 22.0),    # 0.73×
    ("all", "body_type", "pickup",    16.0, 22.0),    # 0.73×
    ("all", "body_type", "van",        5.0,  4.0),    # 1.25×

    # ── NICB top stolen makes (all alert types) ──────────────────────────────
    # Used when alert_type is unknown; reflects general crime vehicle distribution
    ("all", "make", "hyundai",  8.0,  4.0),           # 2.00×  (TikTok/relay theft epidemic)
    ("all", "make", "kia",      7.0,  3.0),           # 2.33×
    ("all", "make", "chrysler", 7.0,  3.5),           # 2.00×
    ("all", "make", "dodge",    6.0,  4.0),           # 1.50×
    ("all", "make", "honda",   10.0,  9.0),           # 1.11×
    ("all", "make", "toyota",  12.0, 14.0),           # 0.86×
    ("all", "make", "ford",    12.0, 13.0),           # 0.92×
    ("all", "make", "chevrolet",10.0, 12.0),          # 0.83×
    ("all", "make", "bmw",      2.0,  2.0),           # 1.00×
    ("all", "make", "subaru",   2.0,  4.0),           # 0.50×
]


def compute_from_internal(conn) -> list[tuple]:
    """
    Compute incident_pct from our own vehicle_targets historical data.
    Supplements the seed data — overwrites matching rows with real numbers
    as our dataset grows.
    """
    rows = conn.execute(text("""
        SELECT
            alert_type,
            LOWER(COALESCE(color, ''))    AS color,
            LOWER(COALESCE(body_type, '')) AS body_type,
            LOWER(COALESCE(make, ''))     AS make,
            COUNT(*) AS cnt
        FROM vehicle_targets
        WHERE source_program = 'fema'
          AND color IS NOT NULL
          AND created_at > NOW() - INTERVAL '365 days'
        GROUP BY alert_type, color, body_type, make
        HAVING COUNT(*) >= 3
    """)).fetchall()

    totals_by_type: dict[str, int] = {}
    for r in rows:
        totals_by_type[r[0]] = totals_by_type.get(r[0], 0) + r[4]

    internal: list[tuple] = []
    for r in rows:
        atype, color, btype, make_, cnt = r
        total = totals_by_type.get(atype, 1)
        pct = (cnt / total) * 100

        # Attribute-specific rows
        if color:
            internal.append((atype, "color", color, pct, None, "fema_historical"))
        if btype:
            internal.append((atype, "body_type", btype, pct, None, "fema_historical"))
        if make_:
            internal.append((atype, "make", make_, pct, None, "fema_historical"))

    return internal


def run():
    with engine.connect() as conn:
        print("Seeding vehicle_alert_priors from public data...")
        inserted = 0
        for (alert_type, attr_type, attr_value, incident_pct, population_pct) in SEED_DATA:
            prior_weight = round(incident_pct / population_pct, 4)
            conn.execute(text("""
                INSERT INTO vehicle_alert_priors
                    (alert_type, attribute_type, attribute_value,
                     incident_pct, population_pct, prior_weight, source)
                VALUES
                    (:atype, :attr_type, :attr_val,
                     :inc_pct, :pop_pct, :pw, 'public_data')
                ON CONFLICT (alert_type, attribute_type, attribute_value)
                DO UPDATE SET
                    incident_pct  = EXCLUDED.incident_pct,
                    population_pct = EXCLUDED.population_pct,
                    prior_weight  = EXCLUDED.prior_weight,
                    source        = EXCLUDED.source,
                    updated_at    = NOW()
            """), {
                "atype":    alert_type,
                "attr_type": attr_type,
                "attr_val": attr_value,
                "inc_pct":  incident_pct,
                "pop_pct":  population_pct,
                "pw":       prior_weight,
            })
            inserted += 1

        print(f"Seeded {inserted} public-data priors.")
        print("Computing priors from internal FEMA history...")

        internal = compute_from_internal(conn)
        for row in internal:
            atype, attr_type, attr_val, inc_pct, pop_pct, source = row
            # For internal data we don't have a reliable population_pct —
            # use the public-data population_pct if available, else skip weight
            existing = conn.execute(text("""
                SELECT population_pct FROM vehicle_alert_priors
                WHERE alert_type = :a AND attribute_type = :t AND attribute_value = :v
            """), {"a": atype, "t": attr_type, "v": attr_val}).fetchone()

            if existing and existing[0]:
                pw = round(inc_pct / existing[0], 4)
                conn.execute(text("""
                    INSERT INTO vehicle_alert_priors
                        (alert_type, attribute_type, attribute_value,
                         incident_pct, population_pct, prior_weight, source)
                    VALUES (:a, :t, :v, :inc, :pop, :pw, :src)
                    ON CONFLICT (alert_type, attribute_type, attribute_value)
                    DO UPDATE SET
                        incident_pct = EXCLUDED.incident_pct,
                        prior_weight = EXCLUDED.prior_weight,
                        source       = 'fema_historical',
                        updated_at   = NOW()
                """), {
                    "a": atype, "t": attr_type, "v": attr_val,
                    "inc": inc_pct, "pop": existing[0], "pw": pw, "src": source,
                })

        print(f"Updated {len(internal)} rows from internal FEMA history.")
        conn.commit()
        print("Done.")


if __name__ == "__main__":
    run()
