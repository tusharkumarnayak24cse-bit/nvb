# EventPulse V2

A local event marketplace MVP for Ahmedabad/Gujarat with customer accounts, organizer accounts, event approval, ticket bookings, payment-ready checkout, QR tickets, promotion leads and an admin dashboard.

## Features

- Customer registration/login
- Organizer registration/login
- Organizer dashboard
- Create, edit and delete events
- Admin approval before events go public
- Search/filter public events
- 7% platform fee calculation
- Customer booking history
- Demo payment mode (no money charged)
- Razorpay-ready server integration via environment variables
- QR ticket after successful/free/demo payment
- Organizer QR/manual ticket check-in scanner
- WhatsApp ticket sharing link
- Featured event controls
- Promotion lead forms
- Admin revenue/users/organizers overview

## Run in VS Code

1. Install Node.js 18 or newer.
2. Open this folder in VS Code.
3. Open Terminal and run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`

Pages:
- Marketplace: `http://localhost:3000`
- Account: `http://localhost:3000/account.html`
- Organizer dashboard: `http://localhost:3000/dashboard.html`
- Organizer scanner: `http://localhost:3000/scanner.html`
- Customer tickets: `http://localhost:3000/tickets.html`
- Admin: `http://localhost:3000/admin.html`

## Local admin login

Default development ADMIN_KEY:

```text
change-me-now
```

Change it before deployment.

## Payments

Without Razorpay environment variables, EventPulse runs in **DEMO payment mode**. The user can simulate successful payment and receive a QR ticket, but no real money is charged.

To enable Razorpay after your merchant account is approved, set:

```text
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
```

The backend creates Razorpay orders and verifies payment signatures before activating tickets.

## Deploy on Render

- Build command: `npm install`
- Start command: `npm start`
- Add environment variable `ADMIN_KEY` with a strong random value.
- Add `NODE_ENV=production`.
- Add Razorpay keys only when you are ready for real payments.

### Important database note

This V2 intentionally keeps the simple JSON database from the MVP so it is easy to understand and run. On many cloud hosts, local files are not durable across redeploys/restarts. Before taking real customer payments, move users/events/bookings to a durable database such as PostgreSQL, Supabase or MongoDB.

## Production checklist

Before accepting real bookings:
- Use a durable database.
- Use HTTPS (Render provides this on deployed services).
- Change ADMIN_KEY.
- Configure Razorpay webhooks in addition to browser signature verification.
- Add refund/cancellation rules, Terms, Privacy Policy and organizer agreement.
- Add email/SMS/WhatsApp provider for automatic confirmations.
- Add QR scanning/check-in validation for organizers.
- Back up booking/payment records.

## Revenue model included

- 7% service fee per paid ticket booking.
- Featured event promotion plans starting at ₹499.

