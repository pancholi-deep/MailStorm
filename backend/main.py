from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from email_utils import send_email as send_email_sync
import io, csv, os, asyncio

from dotenv import load_dotenv
load_dotenv()

EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")

if not EMAIL_ADDRESS or not EMAIL_PASSWORD:
    raise RuntimeError("EMAIL_ADDRESS or EMAIL_PASSWORD environment variable not set.")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # your React app URL
    allow_methods=["*"],
    allow_headers=["*"],
)

async def send_email(name, recipient_email, subject, body, email_address, email_password):
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        None,
        send_email_sync,
        name, recipient_email, subject, body, email_address, email_password
    )

def load_email_template_from_string(template_str: str, name: str):
    try:
        subject_line = template_str.split("Body:")[0].replace("Subject:", "").strip()
        body_text = template_str.split("Body:")[1].strip()
    except (IndexError, AttributeError):
        raise ValueError("Template format error: Ensure it has 'Subject:' and 'Body:' sections.")
    return subject_line.format(name=name), body_text.format(name=name)

@app.post("/send-emails")
async def send_emails(csv_file: UploadFile = File(...), template_file: UploadFile = File(...)):
    # Read files fully here (before generator)
    try:
        template_bytes = await template_file.read()
        csv_bytes = await csv_file.read()
    finally:
        # Close files ASAP
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

                subject, body = load_email_template_from_string(template_content, name)
                await send_email(name, recipient_email, subject, body, EMAIL_ADDRESS, EMAIL_PASSWORD)

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
            if success>0:
                yield f"data: \nFinished sending emails. \nSuccess: {success}, Failures: {fail}\n\n"
            else:
                yield f"data: \nFailed to send all {fail} emails.\n\n"
        except (RuntimeError, asyncio.CancelledError):
            pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")