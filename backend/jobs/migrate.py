from backend.jobs.database import Database

if __name__ == '__main__':
    database = Database()
    database.migrate()
    database.verify()
    print('Durable job schema is at version 1.')
