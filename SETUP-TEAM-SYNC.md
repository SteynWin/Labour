# Turning on team sync (5 managers, shared live data)

Right now the planner saves data in *your* browser only (`localStorage`).
To let several managers fill it in from their own phones and all see the
same jobs, team mates and weekly plan, you need a free Firebase project.
This is a one-time setup, about 10 minutes, done in your web browser with
a Google account (a personal Gmail account works fine).

Nothing here costs money. Firebase's free "Spark" plan does not require a
credit card and easily covers a small team doing weekly planning.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **"Add project"**.
3. Give it a name, e.g. `labour-planner`. Click **Continue**.
4. When asked about Google Analytics, you can turn it **off** (not needed). Click **Create project**.
5. Wait for it to finish, then click **Continue**.

## 2. Turn on Firestore (the database)

1. In the left sidebar, click **Build → Firestore Database**.
2. Click **Create database**.
3. Pick a location close to you (the default is usually fine) → **Next**.
4. Choose **Start in production mode** → **Create**. (We'll set the exact access rule ourselves in step 4.)

## 3. Register a "web app" to get your config

1. Click the **gear icon** (top left, next to "Project Overview") → **Project settings**.
2. Scroll down to **"Your apps"**.
3. Click the **`</>`** (web) icon.
4. Give it a nickname, e.g. `weekly-planner-web` → **Register app**.
5. You'll see a code block that looks like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "labour-planner-xxxxx.firebaseapp.com",
     projectId: "labour-planner-xxxxx",
     storageBucket: "labour-planner-xxxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef123456"
   };
   ```

6. Copy those 6 values (you don't need any of the surrounding code).
7. Click **Continue to console**.

## 4. Set the access rule

Since managers open this with just a link (no login), the database needs
to allow reads/writes without requiring a login. That means anyone who
has your Firebase project's config (visible in the page source of your
site) could in theory read or write to it directly - not just through the
app. For a small internal planning tool this is a reasonable, low-risk
tradeoff, but it's worth knowing.

1. In the left sidebar, **Build → Firestore Database**, click the **Rules** tab.
2. Replace the contents with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```

3. Click **Publish**.

## 5. Fill in `firebase-config.js`

1. In your copy of this repo, open `firebase-config.js`.
2. Replace the placeholder values with the 6 values you copied in step 3. For example:

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "labour-planner-xxxxx.firebaseapp.com",
     projectId: "labour-planner-xxxxx",
     storageBucket: "labour-planner-xxxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef123456"
   };
   ```

3. Save the file, commit it, and push (or ask Claude to do this for you if you paste in the 6 values).

## 6. Check it worked

1. Open your GitHub Pages link (e.g. `https://steynwin.github.io/Labour/`).
2. In the top-right of the page you should see a status pill change from
   **"Local only"** to **"Live — shared with your team"**.
3. Add a job or a task, then open the same link on your phone (or a
   different browser). It should appear there too, within a second or two.

## 7. Send the link to your 5 managers

Just send them the same GitHub Pages URL. No account, no app install -
they open it in any phone browser and it works. Everyone sees the same
jobs, team mates and weekly plan, live.

## If something looks wrong

- Status pill stuck on **"Connecting…"** or shows **"Sync error"**: double-check
  the 6 values in `firebase-config.js` were copied correctly (no extra
  quotes/spaces), and that you published the Firestore rule in step 4.
- Old data you already had (saved locally before turning this on) does **not**
  automatically move to the shared database. Use **Download Backup** before
  switching on team sync, then **Restore Backup** afterwards to bring it in.
