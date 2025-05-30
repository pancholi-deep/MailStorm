# 📧 Mass Email Sender

A full-stack web application that enables users to send personalized bulk emails effortlessly. Upload a CSV file containing recipient details, craft an email template with placeholders, and dispatch customized emails to each recipient via SMTP.

## 🚀 Features

* **CSV Upload**: Import recipient data seamlessly.
* **Template-Based Emails**: Utilize placeholders like `{name}` and `{email}` for personalization.
* **Bulk Email Dispatch**: Send individualized emails to multiple recipients in one go.
* **SMTP Integration**: Secure and reliable email sending using SMTP protocols.

## 🛠️ Tech Stack

* **Frontend**: React with Vite
* **Backend**: FastAPI (Python)
* **Email Engine**: SMTP via `smtplib`
* **File Handling**: `csv`, `email`, `starlette`, `pydantic`

## 📁 Project Structure

```
mass-email-sender/
├── backend/
│   ├── main.py           # FastAPI application entry point
│   ├── models.py         # Pydantic models for request/response schemas
│   ├── utils.py          # Utilities for email sending and CSV parsing
│   ├── requirements.txt  # Python dependencies
│   └── .env              # SMTP credentials (excluded from version control)
├── frontend/
│   ├── public/           # Static assets
│   └── src/
│       ├── App.jsx       # Main React component
│       ├── components/   # Upload and Email form components
│       └── services/     # API service for backend communication
├── .gitignore
├── LICENSE
└── README.md
```

## ⚙️ Setup Instructions

### Prerequisites

* **Node.js** (v14 or above)
* **Python** (v3.8 or above)
* **GMail Credentials**: Gmail Account

### Backend Setup

1. **Navigate to the backend directory**:

   ```bash
   cd backend
   ```

2. **Create a virtual environment**:

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables**:

   * Create a `.env` file in the `backend/` directory with the following content:

     ```
     SMTP_SERVER=smtp.example.com
     SMTP_PORT=587
     SMTP_USERNAME=your_email@example.com
     SMTP_PASSWORD=your_email_password
     ```

5. **Run the FastAPI server**:

   ```bash
   uvicorn main:app --reload
   ```

### Frontend Setup

1. **Navigate to the frontend directory**:

   ```bash
   cd frontend
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Start the development server**:

   ```bash
   npm run dev
   ```

4. **Access the application**:

   * Open your browser and navigate to `http://localhost:3000`

## 📄 Usage

1. **Upload CSV**:

   * Click on the "Upload CSV" button and select your CSV file containing recipient details.

2. **Upload Email Template**:

   * Upload a .txt/.html file with your email subject and body.
   * Use placeholders like `{name}` and `{email}` to personalize the content.

3. **Send Emails**:

   * Click on the "Send Emails" button to dispatch personalized emails to all recipients.

## 🧪 Testing

* **Backend**:

  * Utilize tools like `pytest` to write and run tests for your FastAPI endpoints.
* **Frontend**:

  * Employ testing libraries such as `Jest` and `React Testing Library` for component testing.

## 📄 License

This project is licensed under the [MIT License](LICENSE).