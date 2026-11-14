# Deploying Vrunda Infotech (VepariBook) on Render

This guide walks you through deploying **Vrunda Infotech** on [Render](https://dashboard.render.com/) connecting to your **PostgreSQL Database** with 1 click using the Render Blueprint (`render.yaml`).

---

## 🚀 One-Click Deployment (Recommended)

Render provides **Blueprints** (Infrastructure as Code) which automatically detect and deploy your Web Service from your GitHub repository.

### Step 1: Open Render Dashboard
1. Go to [https://dashboard.render.com/](https://dashboard.render.com/) and sign in.

### Step 2: Create a New Blueprint Instance
1. In the top right corner of the dashboard, click **"New +"**.
2. Select **"Blueprint"** from the menu.

### Step 3: Connect your GitHub Repository
1. Select your GitHub repository:
   **`MihirPatel92/VepariBook`**
2. Choose branch: **`main`**.
3. Render will read `render.yaml` and display the service it is about to deploy:
   - **`veparibook`** (Web Service - Node.js 22 - Free tier)
   - Pre-connected to your PostgreSQL database: `veparibook-vrundainfotech-d45f.i.aivencloud.com`

### Step 4: Configure DATABASE_URL & Apply Blueprint
1. Render will prompt you for the **`DATABASE_URL`** value (marked `sync: false` for security).
2. Paste your PostgreSQL Service URI:
   `postgres://avnadmin:YOUR_PASSWORD@veparibook-vrundainfotech-d45f.i.aivencloud.com:22669/defaultdb?sslmode=require`
3. Click **"Apply"**.
4. Render will immediately:
   - Build the backend and web frontend.
   - Run database migrations (`migrate.mjs`) on your cloud PostgreSQL database.
   - Verify/seed the Owner account (`Contact@vrundainfotech.com` / `Vrunda@1995`).
   - Start the web service and provide you with a live HTTPS URL.

### Step 5: Access Your Live Application
1. When deployment status turns green (**"Live"**), click the URL (e.g. `https://veparibook.onrender.com`).
2. Log in using your Owner credentials:
   - **Email:** `Contact@vrundainfotech.com`
   - **Password:** `Vrunda@1995`

---

## 🔑 Pre-Configured Owner Account

| Detail | Value |
|---|---|
| **Email** | `Contact@vrundainfotech.com` |
| **Password** | `Vrunda@1995` |
| **Role** | `owner` (Full administrator rights to add/create businesses) |
| **Organization** | Vrunda Infotech Organization |
| **Plan** | Enterprise (Unlimited businesses allowed) |

---

## ⚙️ Connected Database Configuration

Your cloud PostgreSQL database is connected and already initialized with all tables:

| Detail | Value |
|---|---|
| **Host** | `veparibook-vrundainfotech-d45f.i.aivencloud.com` |
| **Port** | `22669` |
| **Database** | `defaultdb` |
| **User** | `avnadmin` |
| **SSL Mode** | `require` |

---

## 🔄 Automatic Redeployments

Every time you push new code to the `main` branch of `https://github.com/MihirPatel92/VepariBook`, Render will automatically:
1. Re-build the application.
2. Run any new migrations seamlessly.
3. Deploy the latest version with zero downtime.
