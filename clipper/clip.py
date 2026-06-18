"""`clip` CLI entrypoint. Run `python clip.py --help` for usage."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import click
import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402

load_dotenv(ROOT / ".env")


def load_config() -> dict:
    with open(ROOT / "config.yaml") as f:
        return yaml.safe_load(f)


@click.group()
@click.pass_context
def cli(ctx: click.Context):
    """Faceless Clip Pipeline.

    Daily flow:
        clip run      # trends → ingest → scout → cut → package (unattended)
        clip trends   # only discover trendjacking opportunities
        clip review   # approve queue at localhost:8765
        clip post     # publish approved clips
    """
    db.init_db()
    ctx.obj = load_config()


@cli.command()
@click.pass_obj
def status(cfg: dict):
    """Show queue + recent activity at a glance."""
    with db.connect() as conn:
        cand = conn.execute(
            "SELECT status, COUNT(*) c FROM candidates GROUP BY status"
        ).fetchall()
        clip_counts = conn.execute(
            "SELECT status, COUNT(*) c FROM clips GROUP BY status"
        ).fetchall()
        recent = conn.execute(
            "SELECT id, video_id, status, virality_score, created_at "
            "FROM clips ORDER BY id DESC LIMIT 10"
        ).fetchall()
        trend_counts = conn.execute(
            "SELECT status, rights_status, COUNT(*) c "
            "FROM trend_opportunities GROUP BY status, rights_status"
        ).fetchall()
        recent_trends = conn.execute(
            "SELECT id, source_kind, rights_status, trend_score, title, discovered_at "
            "FROM trend_opportunities ORDER BY id DESC LIMIT 10"
        ).fetchall()

    click.echo(f"niche: {cfg['niche']}")
    click.echo("\ncandidates:")
    for r in cand:
        click.echo(f"  {r['status']:<14} {r['c']}")
    click.echo("\nclips:")
    for r in clip_counts:
        click.echo(f"  {r['status']:<14} {r['c']}")
    click.echo("\nrecent clips:")
    for r in recent:
        click.echo(
            f"  #{r['id']:<4} {r['video_id']:<14} {r['status']:<14} "
            f"score={r['virality_score']!s:<5} {r['created_at']}"
        )
    click.echo("\ntrend opportunities:")
    for r in trend_counts:
        label = f"{r['status']}:{r['rights_status']}"
        click.echo(f"  {label:<24} {r['c']}")
    click.echo("\nrecent trends:")
    for r in recent_trends:
        title = (r["title"] or "")[:72]
        click.echo(
            f"  #{r['id']:<4} {r['source_kind']:<18} {r['rights_status']:<15} "
            f"score={r['trend_score']!s:<4} {title}"
        )


@cli.command()
@click.option("--skip-trends", is_flag=True, help="Skip trendjacking discovery lane.")
@click.option("--skip-source",  is_flag=True, help="Skip stage 1 (use existing candidates).")
@click.option("--skip-ingest", is_flag=True, help="Skip stage 2 (use existing transcripts).")
@click.option("--skip-scout",  is_flag=True, help="Skip stage 3.")
@click.option("--skip-cut",    is_flag=True, help="Skip stage 4.")
@click.option("--skip-package",is_flag=True, help="Skip stage 5.")
@click.pass_obj
def run(cfg: dict, skip_trends: bool, skip_source: bool, skip_ingest: bool, skip_scout: bool,
        skip_cut: bool, skip_package: bool):
    """Run trend discovery + stages 1–5: source → ingest → scout → cut → package."""
    from pipeline import trend, source, ingest, scout, cut, package

    if not skip_trends:
        click.echo("→ trend lane: discover")
        trend.run(cfg)
    if not skip_source:
        click.echo("→ stage 1: source")
        source.run(cfg)
    if not skip_ingest:
        click.echo("→ stage 2: ingest")
        ingest.run(cfg)
    if not skip_scout:
        click.echo("→ stage 3: scout")
        scout.run(cfg)
    if not skip_cut:
        click.echo("→ stage 4: cut")
        cut.run(cfg)
    if not skip_package:
        click.echo("→ stage 5: package")
        package.run(cfg)
    click.echo("done. → clip review")


@cli.command(name="trends")
@click.option("--limit", type=int, default=10, help="How many recent opportunities to print.")
@click.pass_obj
def trends_cmd(cfg: dict, limit: int):
    """Discover daily trendjacking opportunities with rights gating."""
    from pipeline import trend

    trend.run(cfg)
    rows = trend.recent(limit=limit)
    if not rows:
        click.echo("no trend opportunities yet")
        return
    click.echo("\nrecent trend opportunities:")
    for r in rows:
        click.echo(
            f"  #{r['id']:<4} score={r['trend_score']:<3} "
            f"{r['rights_status']:<15} {r['recommended_format']:<16} "
            f"{(r['title'] or '')[:72]}"
        )
        click.echo(f"       {r['url']}")


@cli.command()
@click.pass_obj
def review(cfg: dict):
    """Launch the review dashboard at localhost:<port>."""
    import uvicorn
    host = cfg["dashboard"]["host"]
    port = int(cfg["dashboard"]["port"])
    click.echo(f"dashboard → http://{host}:{port}")
    uvicorn.run("dashboard.app:app", host=host, port=port, reload=False)


@cli.command()
@click.option("--clip-id", type=int, default=None, help="Post a single clip by id (default: all approved).")
@click.pass_obj
def post(cfg: dict, clip_id: int | None):
    """Publish all approved clips (YT + IG auto; TikTok → draft)."""
    from pipeline import post as poster
    poster.run(cfg, clip_id=clip_id)


@cli.command(name="purge")
@click.pass_obj
def purge_cmd(cfg: dict):
    """Auto-purge downloads older than retention window."""
    from pipeline import ingest
    ingest.purge_old_downloads(cfg)


@cli.command()
def initdb():
    """Create / migrate the SQLite schema. Safe to re-run."""
    db.init_db()
    click.echo(f"db initialised at {db.DB_PATH}")


if __name__ == "__main__":
    cli()
