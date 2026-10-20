from alembic import context
from app.core.config import get_settings
from app.db.database import make_database
from app.db.models import Base


def run():
    engine, _ = make_database(get_settings().database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run()
