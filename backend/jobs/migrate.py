from backend.jobs.database import Database, SCHEMA_VERSION

if __name__ == "__main__":
    database = Database()
    database.migrate()
    database.verify()
    print(f"Durable job schema is at version {SCHEMA_VERSION}.")
