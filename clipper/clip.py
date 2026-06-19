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
        clip schedule # plan the order for approved clips
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


@cli.command(name="doctor")
@click.pass_context
def doctor_cmd(ctx: click.Context):
    """Check whether the machine is ready for a low-effort daily handoff."""
    from pipeline import doctor

    ready = doctor.print_report(ctx.obj)
    ctx.exit(0 if ready else 1)


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


@cli.command(name="brief")
@click.option("--limit", type=int, default=25, help="How many open trend opportunities to summarize.")
def brief_cmd(limit: int):
    """Print today's trend brief with render/review priorities."""
    from pipeline import brief

    brief.print_brief(limit=limit)


@cli.command(name="import-trends")
@click.argument("path", type=click.Path(exists=True, dir_okay=False))
@click.option("--source", default=None, help="Label for the external tool/export source.")
@click.option("--default-kind", default="social_text", help="Source kind if the CSV has no kind/type column.")
@click.option("--limit", type=int, default=None, help="Maximum rows to import.")
@click.pass_obj
def import_trends_cmd(cfg: dict, path: str, source: str | None, default_kind: str, limit: int | None):
    """Import a CSV/TSV export from an external trend tool into the review queue."""
    from pipeline import trend_import

    inserted = trend_import.import_csv(path, cfg, source=source, default_kind=default_kind, limit=limit)
    click.echo(f"imported {inserted} trend opportunities")


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


@cli.group(name="auth")
def auth_cmd():
    """Set up and verify local API credentials."""


@auth_cmd.command(name="status")
@click.pass_context
def auth_status_cmd(ctx: click.Context):
    """Show platform credential readiness without printing secrets."""
    from pipeline import auth

    ready = auth.print_status(ctx.find_root().obj)
    click.echo(f"\nready credential groups: {ready}")


@auth_cmd.command(name="youtube")
@click.option("--client-secret", type=click.Path(exists=True, dir_okay=False), help="Downloaded Google OAuth client JSON.")
@click.option("--login", is_flag=True, help="Run YouTube OAuth login and save the upload token.")
@click.pass_context
def auth_youtube_cmd(ctx: click.Context, client_secret: str | None, login: bool):
    """Install YouTube OAuth client JSON and optionally run login."""
    from pipeline import auth

    if client_secret:
        dest = auth.install_youtube_client_secret(client_secret)
        click.echo(f"YouTube client secret installed -> {dest}")
    if login:
        token = auth.youtube_login()
        click.echo(f"YouTube OAuth token saved -> {token}")
    if not client_secret and not login:
        auth.print_status(ctx.find_root().obj)


@auth_cmd.command(name="tiktok")
@click.option("--client-key", help="TikTok app client key.")
@click.option("--client-secret", help="TikTok app client secret.")
@click.option("--access-token", help="TikTok user access token from Login Kit OAuth.")
@click.option("--open-id", help="TikTok user open_id from Login Kit OAuth.")
@click.pass_context
def auth_tiktok_cmd(
    ctx: click.Context,
    client_key: str | None,
    client_secret: str | None,
    access_token: str | None,
    open_id: str | None,
):
    """Save TikTok credentials to clipper/.env."""
    from pipeline import auth

    if any([client_key, client_secret, access_token, open_id]):
        auth.set_tiktok_credentials(client_key, client_secret, access_token, open_id)
        click.echo("TikTok credentials updated in clipper/.env")
    auth.print_status(ctx.find_root().obj)


@auth_cmd.command(name="reddit")
@click.option("--client-id", help="Reddit app client ID.")
@click.option("--client-secret", help="Reddit app client secret.")
@click.option("--user-agent", help="Reddit API user agent.")
@click.pass_context
def auth_reddit_cmd(
    ctx: click.Context,
    client_id: str | None,
    client_secret: str | None,
    user_agent: str | None,
):
    """Save Reddit API credentials for reliable trend discovery."""
    from pipeline import auth

    if any([client_id, client_secret, user_agent]):
        auth.set_reddit_credentials(client_id, client_secret, user_agent)
        click.echo("Reddit credentials updated in clipper/.env")
    auth.print_status(ctx.find_root().obj)


@auth_cmd.command(name="anthropic")
@click.option("--api-key", prompt=True, hide_input=True, help="Anthropic API key.")
def auth_anthropic_cmd(api_key: str):
    """Save the Anthropic API key used for AI scouting/packaging."""
    from pipeline import auth

    auth.set_anthropic_key(api_key)
    click.echo("Anthropic API key saved in clipper/.env")


@cli.command(name="schedule")
@click.pass_obj
def schedule_cmd(cfg: dict):
    """Suggest posting order/slots for approved clips."""
    from pipeline import schedule
    schedule.apply_schedule(cfg)


@cli.command(name="integrations")
@click.pass_obj
def integrations_cmd(cfg: dict):
    """Show optional AI editor/render/publisher integration readiness."""
    from pipeline import integrations
    ready = integrations.print_status(cfg)
    click.echo(f"\nready integrations: {ready}")


@cli.command(name="polish")
@click.option("--clip-id", type=int, required=True, help="Rendered clip id to package for polish.")
@click.option(
    "--provider",
    type=click.Choice(["palmier_pro", "descript", "runway"]),
    default="palmier_pro",
    show_default=True,
    help="External tool handoff target.",
)
@click.option("--copy-media", is_flag=True, help="Copy MP4/source/transcript into the handoff folder.")
@click.pass_obj
def polish_cmd(cfg: dict, clip_id: int, provider: str, copy_media: bool):
    """Create a handoff package for optional external AI editor polish."""
    from pipeline import polish

    out_dir = polish.export_handoff(cfg, clip_id=clip_id, provider=provider, copy_media=copy_media)
    click.echo(f"polish handoff -> {out_dir}")


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
