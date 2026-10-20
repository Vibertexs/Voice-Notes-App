"""The legal pages: privacy policy, terms, recording and consent notice, account deletion.

They are served by the API itself (routes_legal.py) so the app, the Google sign-in
consent screen and the store listing can all link to a real address without a separate
website. Who operates the service and how to reach them come from settings
(LEGAL_OPERATOR, LEGAL_CONTACT_EMAIL, LEGAL_JURISDICTION), so none of it is hard-coded
into the repository.

The text describes what the app and server actually do - audio stays on the phone, only
text is backed up, who the service providers are, how long things are kept. If any of
that changes, change it here in the same commit, and bump UPDATED.

These documents are a good-faith starting point, not legal advice. Have a lawyer review
them before relying on them for a public launch.
"""
from __future__ import annotations

import html
from dataclasses import dataclass

from backend.cloud.config import Settings

UPDATED = "October 19, 2026"
APP = "Ekho"


@dataclass(frozen=True)
class Page:
    slug: str
    title: str
    summary: str
    body: str            # HTML with {operator}, {contact}, {law} placeholders


PRIVACY = """
<p>{app} is a lecture recorder. This policy explains what it collects, why, who helps run it, and the
choices you have. {operator} operates {app} (&ldquo;we&rdquo;, &ldquo;us&rdquo;).</p>

<h2>The short version</h2>
<ul>
<li><strong>Your audio never leaves your phone.</strong> Recordings are saved and transcribed on the device.</li>
<li>If you sign in, we back up the <strong>text</strong>: transcripts, titles, folders, bookmarks and notes.</li>
<li>We do not sell your data, show ads, or use advertising or analytics trackers.</li>
<li>You can delete your account and everything we hold from inside the app.</li>
</ul>

<h2>What stays on your phone</h2>
<p>Your audio recordings, the speech model the app downloads, and a local copy of your library. We never
receive your audio.</p>

<h2>What we store when you sign in</h2>
<ul>
<li><strong>Account:</strong> your email address and Google account identifier (from Google Sign-In), and when
the account was created and last used.</li>
<li><strong>Your backed-up library:</strong> folder names, colours and icons; recording titles, dates,
durations, bookmarks (label and time) and the notes you type; and transcripts (the words and when each was said).</li>
<li><strong>Sessions:</strong> a label for each signed-in device (such as the phone model) and timestamps. Only
a hash of the secret that keeps you signed in is stored.</li>
<li><strong>Assistant connections:</strong> the name of each AI assistant you connect, its read-only permission,
and when it was created and last used. Only hashes of its keys are stored.</li>
<li><strong>Search:</strong> to find passages by meaning, we split transcripts into passages of about a minute
and store them with numeric representations (&ldquo;embeddings&rdquo;). Words you type into the
&ldquo;match by meaning&rdquo; search are sent to our server for that purpose. You can turn this off in the
app&rsquo;s search screen.</li>
<li><strong>Technical data:</strong> IP address and request details in server logs, and short-lived counters
(with hashed identifiers) that limit abuse, kept for a limited time for security.</li>
</ul>
<p>We do not collect your audio, contacts, location or advertising identifiers.</p>

<h2>How we use it</h2>
<p>To back up and sync your library between your devices, to provide search, to let assistants you choose read
your lectures, to keep the service secure, to send account emails you ask for (such as a reset code), and to
fix problems. Where the law requires a legal basis, it is performing our agreement with you and our
legitimate interest in running a secure service.</p>

<h2>Who helps us run it</h2>
<p>We use service providers who process data on our behalf:</p>
<ul>
<li><strong>MongoDB, Inc. (Atlas)</strong> &mdash; database hosting, including the feature that turns passages and
search words into embeddings.</li>
<li><strong>Amazon Web Services</strong> &mdash; server hosting and encrypted database backups.</li>
<li><strong>Google</strong> &mdash; Google Sign-In. Google&rsquo;s own privacy policy applies to that step.</li>
<li><strong>Resend</strong> &mdash; sends account emails, only when one is needed.</li>
<li><strong>Hugging Face</strong> &mdash; hosts the speech-recognition model your phone downloads once; downloading
it shares your IP address with them.</li>
</ul>
<p>We do not sell your personal information or share it for advertising.</p>

<h2>AI assistants you connect</h2>
<p>If you connect an assistant such as Claude or ChatGPT, it can read your recording titles, folders, bookmarks,
transcripts and notes, and search them. What it reads is then handled by that assistant&rsquo;s company under
its own terms and privacy policy, not ours. Access is read-only, you choose whether to connect, and you can
disconnect any assistant at any time in the app (Assistants).</p>

<h2>Other people&rsquo;s words</h2>
<p>Transcripts may contain what other people said. You are responsible for recording lawfully; see our
<a href="/recording-consent">Recording and consent</a> notice.</p>

<h2>How long we keep it</h2>
<ul>
<li>Your library is kept until you delete it or delete your account.</li>
<li>When you delete a recording, its content is removed immediately. A small marker may remain for up to
180 days so your other devices learn it was deleted; then it is removed.</li>
<li>Encrypted database backups are kept for 30 days, so deleted data can remain in backups until they expire.</li>
<li>Sign-in sessions and assistant access expire on their own and can be ended earlier by you.</li>
</ul>

<h2>Security</h2>
<p>Data travels over HTTPS. Secrets are stored only as hashes. Every request is limited to the signed-in
account&rsquo;s own data. No system is perfectly secure, and we cannot guarantee absolute security.</p>

<h2>Your choices and rights</h2>
<ul>
<li><strong>Delete everything:</strong> in the app, open your account and choose Delete account. See
<a href="/delete-account">Deleting your account</a>.</li>
<li><strong>Disconnect assistants</strong> in the Assistants screen, or turn off meaning search in Search.</li>
<li>Depending on where you live (for example the EU, UK or California), you may have the right to access,
correct, delete or receive a copy of your data, and to object to certain processing. Contact us and we will
respond within the time the law requires. We do not discriminate against anyone for using these rights.</li>
</ul>

<h2>Children</h2>
<p>{app} is not directed to children under 13 (or under 16 where that is the age of digital consent). We do not
knowingly collect their information; if you think we have, contact us and we will delete it.</p>

<h2>Where data is processed</h2>
<p>Our servers and providers are primarily in the United States. If you use {app} elsewhere, your data is
transferred to and processed there.</p>

<h2>Changes</h2>
<p>If we change this policy we will update the date above, and tell you in the app if the change is material.</p>

<h2>Contact</h2>
<p>{operator}. {contact}</p>
"""

TERMS = """
<p>These terms are an agreement between you and {operator} (&ldquo;we&rdquo;) about using {app}, the app, and
its backup and assistant features. By using {app} you agree to them. If you do not agree, do not use it.</p>

<h2>Who can use it</h2>
<p>You must be at least 13 (or the age of digital consent where you live) and able to enter this agreement. If
you use {app} for school, you must also follow your school&rsquo;s rules.</p>

<h2>Your responsibility when recording</h2>
<p><strong>You are responsible for recording lawfully.</strong> Laws and school rules about recording vary and
many require permission from everyone being recorded. Always get permission before you record, and do not use
{app} to record anyone in a place or situation where they expect privacy. Read our
<a href="/recording-consent">Recording and consent</a> notice. We do not provide legal advice and are not
responsible for how you use {app}.</p>

<h2>Your account and your content</h2>
<p>You sign in with Google. Keep your account secure; you are responsible for activity under it. You own your
recordings, transcripts and notes (&ldquo;your content&rdquo;). You give us permission to store, process and
display your content only as needed to run {app} for you: backing it up, syncing it, searching it, and letting
assistants you connect read it. Audio stays on your device.</p>

<h2>Acceptable use</h2>
<p>Do not use {app} to break the law or anyone&rsquo;s rights, to record people without any legally required
permission, to harass or surveil others, to upload content you have no right to, to attack, overload or probe
the service, or to try to access anyone else&rsquo;s data.</p>

<h2>Transcripts can be wrong</h2>
<p>Transcription is automatic and makes mistakes, especially with accents, noise, names and technical terms.
Summaries, searches and anything an AI assistant tells you about your lectures can also be wrong. Check
important facts against the source, and do not rely on {app} where accuracy or safety matters (for example
medical, legal or safety decisions).</p>

<h2>AI assistants</h2>
<p>If you connect a third-party assistant, what it reads is governed by that company&rsquo;s terms and privacy
policy. We are not responsible for what it does with that information. You can disconnect it at any time.</p>

<h2>The service can change</h2>
<p>{app} is provided as it is available. We may change, suspend or end features, and we do not guarantee that it
will always be available or that backups will never be lost. Keep your own copies of anything important.</p>

<h2>Ending your use</h2>
<p>You can stop using {app} and delete your account at any time (see <a href="/delete-account">Deleting your
account</a>). We may suspend or end access if you break these terms or put the service or others at risk.</p>

<h2>No warranty</h2>
<p>To the fullest extent the law allows, {app} is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;,
without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose
and non-infringement.</p>

<h2>Limit of liability</h2>
<p>To the fullest extent the law allows, we are not liable for indirect, incidental, special or consequential
damages, or for lost data, profits or goodwill, arising from your use of {app}. Our total liability for any
claim is limited to the greater of the amount you paid us in the past 12 months (which may be zero) or
US$50. Nothing here limits liability that cannot be limited by law, and some places do not allow these limits,
so they may not apply to you.</p>

<h2>Third-party software</h2>
<p>{app} includes open-source software and speech models under their own licenses.</p>

<h2>Governing law</h2>
<p>These terms are governed by {law}, without regard to conflict-of-law rules. Where the law of your home country
gives you rights that cannot be waived, those rights remain.</p>

<h2>Changes</h2>
<p>We may update these terms. If a change is material we will tell you in the app. Using {app} after a change
means you accept it.</p>

<h2>Contact</h2>
<p>{operator}. {contact}</p>
"""

RECORDING = """
<p><strong>Always get permission before you record.</strong> {app} makes it easy to record a lecture, and that
convenience comes with a responsibility. This page is general information, not legal advice.</p>

<h2>Why it matters</h2>
<ul>
<li><strong>Laws differ.</strong> In some places only one person in a conversation needs to agree to a recording
(&ldquo;one-party consent&rdquo;). In others, <em>everyone</em> being recorded must agree (&ldquo;all-party
consent&rdquo;); examples in the United States include California and Washington. Other countries have their
own rules, and recording people without their knowledge can be a crime or lead to civil claims.</li>
<li><strong>Schools have rules too.</strong> Many universities and instructors require permission to record
lectures, or limit who may share recordings. Some allow it as an accommodation. Check your syllabus and your
school&rsquo;s policy, and ask your instructor.</li>
<li><strong>Lectures are often protected.</strong> A lecture can be the instructor&rsquo;s intellectual property.
Recording it for your own study is different from sharing or publishing it.</li>
</ul>

<h2>What to do</h2>
<ol>
<li>Ask permission from the instructor and anyone else who may be recorded, before you start.</li>
<li>Follow your school&rsquo;s recording policy and any accommodation you have been granted.</li>
<li>Do not record private conversations, meetings or places where people expect privacy, unless everyone
agrees.</li>
<li>Do not share or post a recording or transcript without permission from the people in it.</li>
<li>Stop recording if anyone asks you to.</li>
</ol>

<h2>How {app} handles this</h2>
<p>Recordings stay on your phone. If you sign in, only the transcript text and your notes are backed up to your
account, and they can include what other people said. You can delete a recording, or your whole account, at any
time. If you connect an AI assistant, it can read those transcripts.</p>

<p>You are responsible for how you use {app}. See our <a href="/terms">Terms of Service</a> and
<a href="/privacy">Privacy Policy</a>.</p>
"""

DELETE = """
<p>You can delete your {app} account, and everything we store for it, whenever you like.</p>

<h2>In the app</h2>
<ol>
<li>Open {app} and tap your account (the person icon).</li>
<li>Choose <strong>Delete account</strong> and confirm.</li>
</ol>

<h2>What gets deleted</h2>
<ul>
<li>Your account, sign-in sessions, assistant connections and access keys.</li>
<li>Everything backed up for you: folders, recording titles and details, bookmarks, notes, transcripts, and the
search passages made from them.</li>
</ul>

<h2>What does not</h2>
<ul>
<li><strong>Recordings and files on your phone.</strong> Audio never left your phone, so it stays there until you
delete it or uninstall the app.</li>
<li><strong>Backups.</strong> Encrypted database backups are kept for 30 days and then expire; deleted data can
remain in them until then.</li>
</ul>

<h2>Cannot use the app?</h2>
<p>Contact us from the email address on your account and we will delete it for you. {operator}. {contact}</p>
"""

PAGES: dict[str, Page] = {page.slug: page for page in (
    Page("privacy", "Privacy Policy", "What Ekho collects, why, and your choices.", PRIVACY),
    Page("terms", "Terms of Service", "The agreement for using Ekho.", TERMS),
    Page("recording-consent", "Recording and consent", "Get permission before you record.", RECORDING),
    Page("delete-account", "Deleting your account", "How to delete your account and data.", DELETE),
)}

SHELL = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} &middot; {app}</title><meta name="description" content="{summary}">
<style>
:root {{ --bg:#F4F4F6; --card:#FFFFFF; --line:rgba(0,0,0,.12); --text:#16161A; --muted:#62626E; --primary:#E0264D; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#0A0A0D; --card:#1E1E25; --line:rgba(255,255,255,.12); --text:#F4F4F6; --muted:#A3A3AE; --primary:#FF5A78; }} }}
* {{ box-sizing: border-box; }}
body {{ margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--text); font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }}
main {{ max-width:720px; margin:0 auto; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:28px 24px; }}
.brand {{ margin:0 0 4px; font-size:14px; font-weight:700; letter-spacing:.06em; color:var(--primary); }}
h1 {{ margin:0 0 4px; font-size:28px; line-height:1.25; }}
.updated {{ margin:0 0 20px; color:var(--muted); font-size:14px; }}
h2 {{ margin:28px 0 8px; font-size:18px; }}
p, li {{ margin:0 0 12px; }} ul, ol {{ margin:0 0 12px; padding-left:22px; }}
a {{ color:var(--primary); }}
nav {{ max-width:720px; margin:16px auto 0; text-align:center; color:var(--muted); font-size:14px; }}
nav a {{ margin:0 8px; }}
</style></head>
<body><main>
<p class="brand">{brand}</p>
<h1>{title}</h1>
<p class="updated">Last updated {updated}</p>
{body}
</main>
<nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/recording-consent">Recording &amp; consent</a><a href="/delete-account">Delete account</a></nav>
</body></html>"""

INDEX_BODY = """
<p>The documents that apply to {app}:</p>
<ul>
<li><a href="/privacy">Privacy Policy</a> &mdash; what we collect and why</li>
<li><a href="/terms">Terms of Service</a> &mdash; the agreement for using {app}</li>
<li><a href="/recording-consent">Recording and consent</a> &mdash; get permission before you record</li>
<li><a href="/delete-account">Deleting your account</a> &mdash; how to remove your data</li>
</ul>
"""


def _values(settings: Settings) -> dict[str, str]:
    operator = html.escape(settings.legal_operator.strip()) or f"The {APP} developer"
    email = settings.legal_contact_email.strip()
    contact = (f'Contact: <a href="mailto:{html.escape(email, quote=True)}">{html.escape(email)}</a>.' if email
               else "Contact details are on the app&rsquo;s store listing.")
    law = (f"the laws of {html.escape(settings.legal_jurisdiction.strip())}" if settings.legal_jurisdiction.strip()
           else "the laws that apply where the developer is based")
    return {"app": APP, "operator": operator, "contact": contact, "law": law}


def render(settings: Settings, slug: str | None) -> str | None:
    """A legal page as HTML, or None for an unknown slug. slug=None is the index."""
    values = _values(settings)
    if slug is None:
        title, summary, body = "Legal", f"Legal documents for {APP}.", INDEX_BODY
    else:
        page = PAGES.get(slug)
        if page is None:
            return None
        title, summary, body = page.title, page.summary, page.body
    return SHELL.format(
        title=title, summary=html.escape(summary), app=APP, brand=APP.upper(), updated=UPDATED,
        body=body.format(**values))
