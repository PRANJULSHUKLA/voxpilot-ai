import os
import subprocess
import sys
from sqlalchemy import create_engine, inspect


def test_alembic_upgrade_and_downgrade(tmp_path):
    url = f"sqlite:///{tmp_path / 'migration.db'}"
    env = {**os.environ, "DATABASE_URL": url}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], env=env, check=True, capture_output=True)
    engine = create_engine(url)
    assert {"sessions", "messages", "documents", "chunks", "traces"} <= set(inspect(engine).get_table_names())
    engine.dispose()
    subprocess.run([sys.executable, "-m", "alembic", "downgrade", "base"], env=env, check=True, capture_output=True)
    engine = create_engine(url)
    assert not {"sessions", "messages", "documents", "chunks", "traces"} & set(inspect(engine).get_table_names())
    engine.dispose()
