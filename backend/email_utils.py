import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config import EMAIL_HOST, EMAIL_PORT

def send_email(name, email, subject, body, sender_email, sender_password):
    msg = MIMEMultipart()
    msg['From'] = "Deep Pancholi"
    msg['To'] = email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))

    with smtplib.SMTP_SSL(EMAIL_HOST, EMAIL_PORT) as smtp:
        smtp.login(sender_email, sender_password)
        smtp.send_message(msg)
