📧 Email Sender App

A full-stack web application that allows users to:
- Upload a CSV file with recipient details
- Enter an email template using placeholders (e.g., {name}, {email})
- Send personalized emails to each recipient using SMTP

---

Tech Stack

- Frontend: React + Vite
- Backend: FastAPI (Python)
- Email Engine: SMTP via smtplib
- File Handling: csv, email, starlette, pydantic

---

Project Structure

.
├── backend
│   ├── main.py               FastAPI app entry point
│   ├── models.py             Pydantic models for request/response schemas
│   ├── utils.py              Email sending and CSV parsing utilities
│   ├── requirements.txt      Python dependencies
│   └── .env                  SMTP credentials (not committed)
│
├── frontend
│   ├── public/               Static assets
│   ├── src/
│   │   ├── App.jsx           Main React component
│   │   ├── components/       Upload and Email form components
│   │   └── services/         API service for communicating with FastAPI
│   └── vite.config.js        Vite configuration
│
├── .gitignore                Ignore .env and node_modules
└── README.md                 Project documentation

---

How to Run Locally:

 Prerequisites

  Python 3.8+
  Node.js 18+ and npm

---

1. Clone the Repository

git clone git@github.com:<your-username>/<repo-name>.git
cd <repo-name>

---

2. Run the Backend (FastAPI)

cd backend
python -m venv venv                  Create virtual environment
source venv/bin/activate             Activate (use venv\Scripts\activate on Windows)
pip install -r requirements.txt      Install dependencies


 Create a .env file in the backend/ directory with the following content:

env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password


For Gmail users, you must use an App Password if 2FA is enabled.

Then, run the backend server:

uvicorn main:app --reload
 Server will start at: http://localhost:8000

---

3. Run the Frontend (React + Vite)

In a separate terminal:

cd frontend
npm install           Install React dependencies
npm run dev           Start the frontend dev server

 Frontend will be served at: http://localhost:5173

---

4. Test the App

 1. Visit http://localhost:5173
 2. Upload a CSV file (sample below)
 3. Upload an email template .txt like:
   
   Hi {name}, your registered email is {email}.
   

 4. Click Send Emails to trigger backend logic.

---

Sample CSV Format

csv
name,email
Alice,alice@example.com
Bob,bob@example.com

Placeholders in your email body should match the column headers in the CSV.

---

Security Notes

 Credentials are kept in .env and excluded via .gitignore
 Do not use your main email password
 Use Gmail App Passwords if you're using Gmail with 2FA

---

License

MIT License. Feel free to use, modify, and share!

---