"""Request contracts shared by delivery and reusable campaign endpoints."""

from uuid import UUID
from pydantic import BaseModel, Field, field_validator
from backend.utils.validation import validate_field_mapping


class Reservation(BaseModel):
    size: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class Campaign(BaseModel):
    upload_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    subject: str
    body: str
    is_html: bool = False
    field_mapping: dict[str, str] = Field(default_factory=dict)

    @field_validator("field_mapping")
    @classmethod
    def valid_mapping(cls, value):
        return validate_field_mapping(value)


class SavedCampaign(Campaign):
    name: str = Field(min_length=1, max_length=120)
    filename: str = Field(default="contacts.csv", min_length=1, max_length=255)


class NewSavedCampaign(SavedCampaign):
    id: UUID


class UpdatedSavedCampaign(SavedCampaign):
    revision: int = Field(ge=1)


class Revision(BaseModel):
    revision: int = Field(ge=1)
