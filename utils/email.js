import nodemailer from 'nodemailer';

const getTransporter = () =>
  nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

export const sendMail = async ({ to, subject, html }) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[EMAIL SKIPPED]\nTo: ${to}\nSubject: ${subject}`);
    return;
  }
  try {
    await getTransporter().sendMail({
      from: `"TVS AutoParts" <${process.env.EMAIL_USER}>`, to, subject, html,
    });
    console.log(`[EMAIL SENT] → ${to}`);
  } catch (err) { console.error('[EMAIL ERROR]', err.message); }
};

const baseTemplate = (title, body) => `
<div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:auto;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
  <div style="background:#0a1f44;padding:28px 32px;text-align:center">
    <h2 style="color:#fff;margin:0;font-size:20px">${title}</h2>
  </div>
  <div style="padding:28px 32px;background:#fff">${body}</div>
  <div style="padding:16px 32px;background:#f9fafb;text-align:center;font-size:12px;color:#9ca3af">
    © ${new Date().getFullYear()} TVS AutoParts · 1800-258-6454 · support@tvsautoparts.com
  </div>
</div>`;

const credBox = (items) => `
<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;margin:16px 0">
  ${items.map(([k, v]) => `<p style="margin:4px 0;font-size:14px"><strong>${k}:</strong> <code style="background:#e0f2fe;padding:2px 6px;border-radius:4px;font-family:monospace">${v}</code></p>`).join('')}
</div>`;

// ── Templates ──────────────────────────────────────────────────────
export const dealerRequestAdminMail = (req) => ({
  to: process.env.ADMIN_EMAIL,
  subject: `New Dealer Request — ${req.businessName}`,
  html: baseTemplate('New Dealer Application', `
    <p style="font-size:14px;color:#374151">A new dealer application has been submitted.</p>
    ${credBox([['Name', req.name],['Email', req.email],['Phone', req.phone],['Business', req.businessName],['Location', `${req.businessLocation}, ${req.state}`]])}
    ${req.message ? `<p style="font-size:13px;color:#6b7280;margin-top:8px">Message: <em>${req.message}</em></p>` : ''}
    <p style="font-size:13px;color:#9ca3af;margin-top:16px">Log in to the admin panel to approve or reject.</p>
  `),
});

export const dealerRequestApplicantMail = (name, email) => ({
  to: email,
  subject: 'Application Received — TVS AutoParts',
  html: baseTemplate('Application Received ✅', `
    <p style="font-size:14px;color:#374151">Hi <strong>${name}</strong>,</p>
    <p style="font-size:14px;color:#374151">Thank you for applying to become a TVS AutoParts dealer. We have received your application and our team will review it within <strong>3–5 business days</strong>.</p>
    <p style="font-size:14px;color:#374151">We will email you once a decision has been made. If you have questions, reply to this email or call <strong>1800-258-6454</strong>.</p>
  `),
});

export const dealerApprovedMail = (dealer, credentials) => ({
  to: dealer.email,
  subject: '🎉 Dealer Application Approved — TVS AutoParts',
  html: baseTemplate('Welcome, Dealer Partner! 🎉', `
    <p style="font-size:14px;color:#374151">Hi <strong>${dealer.name}</strong>,</p>
    <p style="font-size:14px;color:#374151">Congratulations! Your application has been <strong style="color:#16a34a">approved</strong>. Here are your login credentials:</p>
    ${credBox([['Dealer ID', credentials.dealerId],['Login Email', credentials.email],['Password', credentials.password]])}
    <p style="font-size:14px;color:#374151">Visit <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="color:#0a1f44;font-weight:600">TVS AutoParts Portal</a> and select <strong>"Login as Dealer"</strong>.</p>
    <p style="font-size:12px;color:#9ca3af;margin-top:12px">⚠️ Please change your password after your first login.</p>
  `),
});

// Admin creates dealer directly OR resets password
export const dealerCreatedByAdminMail = (dealer, password, isReset = false) => ({
  to: dealer.email,
  subject: isReset
    ? 'Your TVS Dealer Password Has Been Reset'
    : '🏪 Your TVS Dealer Account is Ready',
  html: baseTemplate(
    isReset ? 'Password Reset by Admin' : 'Dealer Account Created',
    `
    <p style="font-size:14px;color:#374151">Hi <strong>${dealer.name}</strong>,</p>
    <p style="font-size:14px;color:#374151">
      ${isReset
        ? 'Your TVS AutoParts dealer account password has been reset by the admin. Use the credentials below to log in.'
        : 'Your TVS AutoParts dealer account has been created by the admin. Use the credentials below to log in.'}
    </p>
    ${credBox([['Dealer ID', dealer.dealerId],['Login Email', dealer.email],['Password', password]])}
    <p style="font-size:14px;color:#374151">
      Visit <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?type=dealer" style="color:#0a1f44;font-weight:600">TVS AutoParts Portal</a>
      and select <strong>"Login as Dealer"</strong>.
    </p>
    <p style="font-size:12px;color:#9ca3af;margin-top:12px">⚠️ Please change your password after your first login.</p>
  `),
});

export const orderStatusMail = (order, user) => ({
  to: user.email,
  subject: `Order ${order.orderStatus} — #${order.invoiceNumber}`,
  html: baseTemplate(`Order ${order.orderStatus}`, `
    <p style="font-size:14px;color:#374151">Hi <strong>${user.name}</strong>,</p>
    <p style="font-size:14px;color:#374151">Your order <strong>#${order.invoiceNumber}</strong> status has been updated to <strong>${order.orderStatus}</strong>.</p>
    <p style="font-size:14px;color:#374151">Total: <strong>₹${order.totalPrice?.toLocaleString('en-IN')}</strong></p>
    ${order.trackingNumber ? `<p style="font-size:14px;color:#374151">Tracking: <strong>${order.trackingNumber}</strong></p>` : ''}
  `),
});
