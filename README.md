# PropSeek Landing Page + Admin: GitHub Pages + Supabase

- **GitHub Pages** hosts the landing page and the admin panel for free.
- **Supabase** is the database. It stores leads and analytics, handles admin logins, and sends each lead to n8n.

```
Visitor ──form──▶ Supabase (database) ──webhook──▶ n8n
   │                    ▲
   └─ visits/clicks ────┘      Admin panel (GitHub Pages /admin) ──login──▶ Supabase
```

Files in this folder:
```
index.html          ← landing page
config.js           ← paste your Supabase URL + key here (step 3)
admin/              ← admin panel (dashboard, leads, settings)
supabase/setup.sql  ← run this once in Supabase (step 2)
```

---

## STEP 1: Create a Supabase project (5 minutes)

1. Go to https://supabase.com and click **Start your project**. Sign up with GitHub (easiest).
2. Click **New project**.
   - **Name:** `propseek-landing`
   - **Database Password:** let it generate one, then **save it somewhere** (you won't need it often)
   - **Region:** **Asia-Pacific (Sydney)**, closest to your Australian visitors
   - Click **Create new project**, then wait about 2 minutes while it sets up.

---

## STEP 2: Create the database tables (2 minutes)

1. In the left menu, open **SQL Editor** and click **+ New query**.
2. Open `supabase/setup.sql` from this folder in Notepad, select everything (Ctrl+A), copy it (Ctrl+C), and paste it into the editor (Ctrl+V).
3. Click **Run** (bottom right). You should see **"Success. No rows returned"**.
   - If it says the query has destructive operations, click **Run this query**. This is expected, because the script resets its own permissions.

---

## STEP 3: Connect the site to Supabase (2 minutes)

1. In Supabase, go to the **Project Settings** (gear icon) and open **API** or **API Keys**. Copy these two values:
   - **Project URL**, for example `https://abcdxyz.supabase.co` (this may be under **Data API**)
   - **anon public** key (starts with `eyJ...`) **or** **Publishable key** (starts with `sb_publishable_...`)
2. Open `config.js` in Notepad and paste them in:
   ```js
   window.LP_SUPABASE = {
     url: 'https://abcdxyz.supabase.co',
     anonKey: 'eyJhbGciOi....'
   };
   ```
3. Save the file.

> ✅ The anon/publishable key is **safe to be public**. The database rules only let visitors *add* leads; they can never read them.
> ❌ **Never** use the `service_role` or `secret` key here.

---

## STEP 4: Create your admin login (3 minutes)

1. **Turn off public sign-ups** (important):
   Supabase → **Authentication** → **Sign In / Providers** (or **Providers → Email**). Turn **"Allow new users to sign up"** **OFF** and click **Save**.
2. **Create your user:**
   Go to **Authentication** → **Users**, click **Add user**, then **Create new user**.
   - Enter your email and a strong password
   - ✅ Tick **Auto Confirm User**
   - Click **Create user**
3. **Make that user an admin:**
   In **SQL Editor**, click **+ New query** and run this (with your own email):
   ```sql
   insert into public.admins (email) values ('you@sellfiremedia.com');
   ```

---

## STEP 5: Put it on GitHub Pages (5 minutes)

1. Go to https://github.com, click **+** (top right), then **New repository**.
   - **Repository name:** `propseek-melbourne` (or anything you like)
   - Choose **Public** (GitHub Pages is free for public repos)
   - Click **Create repository**
2. On the new repo page, click **uploading an existing file**.
3. **Unzip** `landing-admin-github.zip` on your computer. Open the unzipped folder, select **everything inside it** (`index.html`, `config.js`, `admin`, `supabase`, `README.md`, `.nojekyll`), and drag it all into the GitHub page.
   - Upload the *contents* of the folder, not the zip file itself.
   - Make sure the `config.js` you upload is the one you edited in step 3.
4. Scroll down and click **Commit changes**.
5. Go to repo **Settings** → **Pages** (left menu).
   - **Source:** Deploy from a branch
   - **Branch:** `main`, folder `/ (root)`, then click **Save**
6. Wait 1–2 minutes and refresh. A green box will show your site address, for example:
   - Landing page: `https://YOURNAME.github.io/propseek-melbourne/`
   - Admin panel: `https://YOURNAME.github.io/propseek-melbourne/admin/`

---

## STEP 6: Log in and fill in Settings (3 minutes)

Open `.../admin/` and log in with the email and password from step 4. Then go to **Settings**:

| Setting | What to enter |
|---|---|
| **New-lead webhook URL** | Your n8n **Production** URL (see step 7), then click **Send test** |
| **Status-change webhook URL** | (optional) A second n8n webhook that fires when you change a lead's status |
| **Pixel ID** | Meta Events Manager → Data sources → your Pixel → copy the ID |
| **Report timezone** | `Australia/Melbourne` |
| **Event capacity** | e.g. `150`, which shows a "seats booked" bar on the dashboard |

Click **Save** on each section.

---

## STEP 7: n8n setup

1. In your n8n workflow, add a **Webhook** node and set **HTTP Method** to `POST`.
2. **Activate** the workflow (toggle at the top right).
3. Copy the **Production URL**. This is the one with `/webhook/...`, **not** `/webhook-test/...`.
   - The URL currently in your page is a **test** URL, which only works while you're clicking "Listen for test event".
4. Paste it into Admin → Settings → **New-lead webhook URL**, click **Save**, then **Send test**.
5. In n8n, use the data like this: `{{ $json.body.first_name }}`, `{{ $json.body.email }}`, and so on.

**Fields sent for each lead:**
`type, lead_id, first_name, last_name, full_name, email, mobile, mobile_intl, seats, super_balance, status, status_label, event, event_date, event_location, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, event_id, device, is_duplicate, submitted_at, submitted_at_local, client_ip, user_agent`

> 💡 **Meta Conversions API / email alerts:** since n8n gets `event_id`, `client_ip`, and `user_agent`, you can add a "Facebook Conversions API" or "Send Email" node in n8n. Use the same `event_id` so Meta doesn't count the lead twice.

---

## STEP 8: Test it

1. Open the landing page in an **incognito window**. (Your own browser isn't counted once you've logged in to the admin.)
2. Click "Reserve my seat", fill in the form, and submit.
3. In Admin → **Leads**, the lead should appear with n8n showing **sent**.
4. Admin → **Dashboard** should show 1 visitor, 1 CTA click, and 1 lead.
5. When you're done testing, go to Settings → **Reset analytics** to clear the test visits. Delete the test lead from Leads.

---

## Changing things later

| What | How |
|---|---|
| n8n URL / Pixel ID / statuses | Admin → Settings. No code changes needed. |
| Landing page text | Edit `index.html` on GitHub (pencil icon ✏️) → Commit. Live in about 1 minute. |
| Add another admin | Supabase → Authentication → Add user, then Admin → Settings → Add admin with the same email |
| Forgot password | Supabase → Authentication → Users → ⋯ → Send password recovery, or delete the user and create them again |
| Custom domain (e.g. `event.propseek.com.au`) | GitHub repo Settings → Pages → Custom domain, plus a CNAME record at your domain provider pointing to `YOURNAME.github.io` |
| UTM tracking | Add `?utm_source=facebook&utm_medium=paid&utm_campaign=melb_nov` to your ad links. They'll show separately on the dashboard. |

## Good to know

- **Supabase free plan:** if the project gets no traffic for 7 days, it **pauses**. Go to Supabase and click **Restore** to wake it up. While your ads are running there's always traffic, so this won't happen.
- **If n8n is down,** the lead is still saved in the database. In Leads, filter "n8n: Failed", select those leads, and click **Resend to n8n**.
- **Security:** visitors can only *add* data. Only emails in the `admins` table can see leads. Spam is limited by rate limiting (5 submissions per IP per 10 minutes) and a honeypot field.
