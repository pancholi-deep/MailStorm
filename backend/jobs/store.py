"""Compose repositories over one database and encryption vault.

No transaction is owned here: each repository keeps its original atomic boundary.
"""

from backend.jobs.database import Database
from backend.jobs.crypto import Vault
from backend.jobs.authorizations import AuthorizationRepository
from backend.jobs.sessions import SessionRepository
from backend.jobs.uploads import UploadRepository
from backend.jobs.campaigns import CampaignRepository
from backend.jobs.queue import JobQueue
from backend.jobs.retention import RetentionRepository
from backend.jobs.library import Library


class Store:
    def __init__(self, database=None, vault=None):
        self.database = database if database is not None else Database()
        self.vault = vault if vault is not None else Vault()
        self.authorizations = AuthorizationRepository(self.database, self.vault)
        self.sessions = SessionRepository(self.database, self.vault)
        self.uploads = UploadRepository(self.database)
        self.campaigns = CampaignRepository(self.database, self.vault)
        self.queue = JobQueue(self.database, self.vault)
        self.retention = RetentionRepository(self.database)
        self.library = Library(self.database, self.vault, self.uploads)
