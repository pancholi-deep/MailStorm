from fastapi import APIRouter, UploadFile, File, Header, HTTPException
from fastapi.responses import StreamingResponse
import io, csv, asyncio
from utils.email_utils import load_email_template, send_via_gmail_api
from utils.auth_utils import get_user_info

router = APIRouter()

@router.post("/send-emails")
async def send_emails(
    csv_file: UploadFile = File(...),
    template_file: UploadFile = File(...),
    authorization: str = Header(None),
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    access_token = authorization.removeprefix("Bearer ").strip()
    user_info = get_user_info(access_token)
    sender_name = user_info.get("name")
    sender_email = user_info.get("email")
    try:
        template_bytes = await template_file.read()
        csv_bytes = await csv_file.read()
    finally:
        await template_file.close()
        await csv_file.close()

    template_content = template_bytes.decode("utf-8")
    csv_data = csv_bytes.decode("utf-8")

    async def event_generator():
        csv_io = io.StringIO(csv_data)
        reader = csv.DictReader(csv_io)

        row_no, success, fail = 1, 0, 0
        for row in reader:
            try:
                name_raw = row.get('name', '').strip()
                recipient_email = row.get('email', '').strip()

                if not name_raw or not recipient_email:
                    missing_fields = [field for field, value in [('name', name_raw), ('email', recipient_email)] if not value]
                    raise ValueError(f"Missing field(s): {', '.join(missing_fields)}")

                name = name_raw.split()[0]

                subject, body = load_email_template(template_content, name)
                send_via_gmail_api(access_token, recipient_email, subject, body, sender_name, sender_email)

                success += 1
                msg = f"{row_no}. Success: Name: {name}, Email: {recipient_email}"

            except Exception as err:
                fail += 1
                msg = f"{row_no}. Failed: {err}"

            finally:
                row_no += 1

            try:
                yield f"data: {msg}\n\n"
            except (RuntimeError, asyncio.CancelledError):
                break

            await asyncio.sleep(0)

        try:
            if success > 0:
                yield f"data: \nFinished sending emails. \nSuccess: {success}, Failures: {fail}\n\n"
            else:
                yield f"data: \nFailed to send all {fail} emails.\n\n"
        except (RuntimeError, asyncio.CancelledError):
            pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")
