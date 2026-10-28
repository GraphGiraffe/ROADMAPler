"""Compare the shared project fixtures with PostgreSQL in an isolated Unix socket cluster."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BIN = Path(os.environ.get('PG_BIN') or subprocess.check_output(['pg_config', '--bindir'], text=True).strip())
cluster = Path(tempfile.mkdtemp(prefix='roadmap-contract-'))
started = False


def execute(statement):
    return subprocess.run(
        [str(BIN / 'psql'), '-X', '-qAt', '-h', str(cluster), '-p', '55439', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
        input=statement, capture_output=True, text=True, check=False,
    )


def require(statement):
    result = execute(statement)
    if result.returncode:
        raise RuntimeError(result.stderr)


try:
    subprocess.run([str(BIN / 'initdb'), '-D', str(cluster / 'db'), '--auth=trust', '--no-locale', '-E', 'UTF8'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([str(BIN / 'pg_ctl'), '-D', str(cluster / 'db'), '-l', str(cluster / 'log'), '-o', f"-k {cluster} -p 55439 -c listen_addresses=''", '-w', 'start'], check=True, stdout=subprocess.DEVNULL)
    started = True
    require("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select null::uuid$$;")
    migration = (ROOT / 'server/supabase.sql').read_text()
    require(migration)
    require(migration)
    fixtures = json.loads((ROOT / 'tests/fixtures/project-format.json').read_text())
    for fixture in fixtures:
        encoded = json.dumps(fixture['data'], ensure_ascii=False).replace("'", "''")
        result = execute(f"select roadmap_private.validate_project('{encoded}'::jsonb);")
        accepted = result.returncode == 0
        if accepted != fixture['valid']:
            raise AssertionError(f"{fixture['name']}: expected valid={fixture['valid']}; {result.stderr}")
    print(f"PASS PostgreSQL contract: {len(fixtures)} shared fixtures; repeatable migration; isolated socket only.")
    # Reapply in documented order twice, including a deployed pre-refactor helper.
    # Old compact deployments defined this helper in integration-api.sql.
    legacy = (ROOT / 'server/integrations.sql').read_text()
    require(legacy)
    require("create or replace function roadmap_private.integration_authorize(p_project_id uuid,p_permission text) returns roadmap_private.integration_tokens language plpgsql security invoker set search_path = '' as $$begin raise exception 'stale authorizer'; end$$;")
    for _ in range(2):
        require((ROOT / 'server/integrations.sql').read_text())
        require((ROOT / 'server/integration-api.sql').read_text())
    require((ROOT / 'tests/sql/integration_auth.sql').read_text())
    print("PASS integration authorization: anon/authenticated, full/card/structure/delta RPCs, permissions, expiry, revoke, owner/project isolation, revisions, tombstones, private helper, repeatable upgrade.")
finally:
    if started:
        subprocess.run([str(BIN / 'pg_ctl'), '-D', str(cluster / 'db'), '-m', 'fast', '-w', 'stop'], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shutil.rmtree(cluster)
