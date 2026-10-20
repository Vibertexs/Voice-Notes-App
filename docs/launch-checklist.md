# Launch checklist

What stands between the working app and a public Google Play listing. Roughly in order; the
waiting steps (marked ⏳) are why it takes weeks, so start them first.

## Accounts and approvals

- [ ] ⏳ **Google Play developer account** ($25, identity verification can take days). A new personal
      account must usually run a **closed test with about 12 testers for 14 days** before it can apply
      for production access; check Play Console for the current rule.
- [ ] ⏳ **Publish Google sign-in.** In Google Cloud console > OAuth consent screen: add the app name,
      support email, home page, the privacy policy link (`/privacy`) and the authorized domain
      `ekhoapp.tech`, verify the domain in Search Console (a DNS TXT record), then move the app from
      Testing to In production. In Testing, only listed test users can sign in, including on the
      assistant sign-in page.
- [ ] Authorized JavaScript origin `https://api.ekhoapp.tech` on the **Web** OAuth client (done).
- [ ] Android OAuth client: package name + the **release** signing key's SHA-1 (Play App Signing
      gives you a different SHA-1 than a local build; add both).

## The app

- [ ] **Decide the final Android package id** with the domain (for example `tech.ekhoapp.app`). It is
      permanent once uploaded. Today it is `com.classnotes.app`; changing it makes a new install, so
      do it before any real users. Update `android.package` / `ios.bundleIdentifier` in
      `mobile/app.json`, the Google Android OAuth client, and the EAS project.
- [ ] **A new native build is needed** (JS reloads are not enough) for: the new icon and splash, and
      **Share audio**, which uses the `expo-sharing` native module. Until then Share transcript works
      (it uses React Native's own share sheet) and Share audio says the app needs updating.
- [ ] Build: `npx eas build --profile production --platform android` (an app bundle for Play).
- [ ] Look at it on a real phone: the new icon and splash (need a native build), the account-switch
      screen, the recording notice, the search toggle, and that the Android status bar icons are
      visible (`App.js` uses `dark-content` on a dark UI).
- [ ] Set the server's `LEGAL_OPERATOR`, `LEGAL_CONTACT_EMAIL` and `LEGAL_JURISDICTION`, then open
      `/privacy`, `/terms`, `/recording-consent` and `/delete-account` and read them once.
- [ ] Have a lawyer review the legal pages before charging money or marketing widely.

## The listing

- [ ] Fill in `docs/store/listing.md` (text, Data safety form, declarations).
- [ ] Real phone screenshots (at least 2).
- [ ] Add a Google test account to the "App access" instructions.

## The server

- [ ] Confirm `https://api.ekhoapp.tech/readyz` is healthy and the legal pages load without signing in.
- [ ] Put a reminder 2 months before `ekhoapp.tech` renews (the first year was discounted).
- [ ] Optional: verify a sending domain in Resend so password-reset email can reach anyone; set
      `EMAIL_FROM` to match. (Sign-in is Google-only in the app, so this matters little.)
- [ ] Optional: auto-deploy from GitHub, and an uptime alert on `/readyz`.
- [ ] Run `git pull` on the server from `main` instead of the old working branch.
