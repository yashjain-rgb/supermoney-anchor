rev 13/10/26
# Supermoney Anchor Platform - Supply Chain Finance
test
This project is a comprehensive, enterprise-grade web application designed to manage the complexities of supply chain financing. Built with a modern technology stack, it serves as a central hub for "Anchors" (large corporations), their "Dealers" (retailers/suppliers), and internal administrative users to manage financing programs, invoices, and a complete dealer onboarding workflow.

The platform is designed to be highly modular and role-driven, providing tailored experiences and functionalities based on user roles and sub-roles.

## Key Featureste

### 1. Multi-Faceted Dashboards
- **Anchor Dashboard**: Provides a high-level overview of credit utilization, overdue amounts, recent invoice activity, and program performance. Includes quick actions and an AI assistant for natural language queries.
- **Onboarding Dashboard**: A role-specific dashboard that presents actionable tasks and key statistics related to the dealer onboarding pipeline.

### 2. Comprehensive User & Role Management
- **Role-Based Access Control (RBAC)**: The application supports distinct roles (`Admin`, `Anchor`, `SuperMoney User`) with different levels of access and functionality.
- **Granular Sub-Roles**: For enterprise clients, detailed sub-roles (`sales_person`, `sales_manager`, `onboarding_ops`, `field_inspector`, `legal_compliance`, `regional_manager`, `dealer_admin`) enable a sophisticated, multi-stage dealer onboarding process.
- **User Management**: Admins can add, view, and manage all user accounts in the system.

### 3. End-to-End Dealer Onboarding Workflow
A complete, state-driven workflow for bringing new dealers onto the platform:
- **Lead Creation**: Sales personnel can add new dealer leads.
- **Validation**: Sales managers approve or reject new leads.
- **Document Management**: Collect, upload, view, and verify essential documents (e.g., GST, PAN).
- **Site Visits**: Field inspectors can submit site visit reports with notes and images.
- **Credit & Limit Approval**: Regional managers perform AI-assisted credit checks and approve business limits.
- **Dealer Activation**: Admins finalize the process and activate the dealer account.

### 4. Financial & Program Management
- **Program Management**: Admins can create and manage financing programs, linking them to specific lenders and anchors.
- **Dealer & Limit Management**: Admins can bulk-import dealers and their associated credit limits via Excel uploads.
- **Invoice Processing**: Users can raise invoices, view invoice statuses, and filter through invoice history.

### 5. AI-Powered Intelligence (Powered by Genkit & Gemini)
- **AI Invoice Reader**: Upload an invoice document (PDF, JPG, PNG), and the AI automatically extracts key data like invoice number, dealer name, amount, and due date, pre-filling forms to reduce manual entry.
- **AI Risk Assessment**: Select a dealer to generate an on-demand risk score and analysis based on their invoice history and payment behavior.
- **AI Assistant**: An integrated chat interface on the dashboard allows users to ask questions about their data in natural language (e.g., "How many invoices are overdue?").

### 6. Collections & Repayments
- **Collection Dashboard**: A dedicated interface for the collections team to track invoice repayments.
- **AI-Assisted Repayment Creation**: Upload an invoice to automatically extract details and send a repayment link to the dealer's contact.
- **Actionable Tracking**: Resend links and log payments for each outstanding invoice.

## Technology Stack

- **Frontend**: Next.js 15 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS, ShadCN UI for component library
- **Backend & Database**: Firebase (Firestore)
- **Generative AI**: Google AI (Gemini) via Genkit
- **Authentication & Sessions**: Iron Session
- **File Handling**: `xlsx` for Excel file processing
- **Email**: Nodemailer for sending transactional emails

## Getting Started Locally

### 1. Prerequisites
- Node.js (v20 or later)
- An active Firebase project with Firestore enabled.
- A Google AI (Gemini) API Key.

### 2. Create the Environment File
The most common reason for login issues on a local machine is a missing or incorrect `.env` file. This file stores all the necessary credentials for the application to work.

**Create a file named `.env` in the root of your project directory.** Copy and paste the following content into it, then fill in the values with your actual credentials.

```env
# ------------------------------------------------------------------
# IMPORTANT: Fill these values with your own project credentials.
# ------------------------------------------------------------------

# Firebase Credentials (get these from your Firebase project settings)
# Go to Project Settings > General > Your apps > SDK setup and configuration
NEXT_PUBLIC_FIREBASE_API_KEY="your-firebase-api-key"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="your-project-id.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="your-project-id"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="your-project-id.appspot.com"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="your-sender-id"
NEXT_PUBLIC_FIREBASE_APP_ID="your-app-id"

# Google AI (Gemini) API Key (from Google AI Studio)
SECRET_GEMINI_API_KEY="your-gemini-api-key"

# Email (SMTP) Credentials (optional, for sending emails)
# If you don't need email functionality, you can leave these blank.
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_USER="your-email@example.com"
SMTP_PASS="your-email-password-or-app-password"

# Session Secret (CRITICAL FOR LOGIN)
# This MUST be a random string of at least 32 characters.
# You can generate one here: https://1password.com/password-generator/
SECRET_COOKIE_PASSWORD="generate-a-strong-random-password-of-at-least-32-characters"
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Seed the Database
The project includes dummy data in `src/lib/dummy-data.ts`. To log in, you must add this data to your Firestore database. The easiest way is to use the bulk-add features within the application itself after you've set it up.

**Initial Login Credentials:**
- **Email:** `admin@supermoney.in`
- **Password:** `password`

Log in as the admin, then navigate to the "Add X (Bulk)" pages to upload the sample data.

### 5. Run the Development Servers
The application requires two separate processes to run concurrently.

**Terminal 1: Start the Next.js Web Server**
```bash
npm run dev
```
This will start the web application, typically on `http://localhost:9002`.

**Terminal 2: Start the Genkit AI Server**
```bash
npm run genkit:dev
```
This starts the local Genkit service that the Next.js app communicates with for all AI-related tasks.

After completing these steps, you should be able to open `http://localhost:9002` in your browser and log in successfully.
