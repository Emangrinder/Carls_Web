# Carls_Web

A fantasy football web app hosted on GitHub Pages, backed by a Supabase database of public NFL data (nflverse).

## Scope

- Player info, images, and college stats
- Play-by-play and season stats for 2024 and 2025
- Team stats (updated through the season)
- Coach info (HC/OC/DC)
- Injury reports and transactions

## Stack

- **Frontend**: React + Vite + Tailwind, deployed to GitHub Pages
- **Database**: Supabase (Postgres), public read-only access via RLS
- **Data pipeline**: scheduled GitHub Action pulling nflverse data into Supabase

## Status

Early setup — repo and infra scaffolding in progress.
