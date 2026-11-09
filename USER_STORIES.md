# Klimaattool — User stories

Nov 9, 2026 · Flavio

## Context and roles

The production Groene Coach replaces every simulated part of the PoC v2 with the real Microsoft 365 stack for Gemeente Amsterdam, and keeps its rules. Those rules: the civil servant always decides, nothing is ever hard-deleted, and CO2 is always shown as a range.

| PoC (mock-up) | Real tool |
| --- | --- |
| SQLite tenant simulation (`graphMock.js`) | Microsoft Graph with an on-behalf-of (OBO) token |
| HMAC demo tokens + user picker | Entra ID Teams SSO, MSAL Node, JWKS validation, secrets in Key Vault |
| `index.html` in a browser | Teams personal tab via an app manifest |
| `outlook.html` simulation | Outlook event-based add-in (`OnMessageSend`, `PromptUser`) |
| Local VM, SQLite telemetry | Azure hosting, Azure SQL or Dataverse with the same aggregated schema |
| Recycle-bin flag in the database | Graph `DELETE` to the recycle bin, plus `restore`; never `permanentDelete` |

**Roles used in the stories**

| Role | Who | Main interest |
| --- | --- | --- |
| Civil servant | Any employee with a OneDrive and Outlook | Quick, optional tips that do not slow down their work |
| Team lead | Head of a department | How the department is doing, without seeing individuals |
| Tenant admin | M365 / Entra administrator | Safe install, consent, rollout and switch-off |
| CISO | Information security officer | Least privilege, token safety, logging |
| Privacy officer | FG / privacy officer | AVG/GDPR: minimal data, retention, k-anonymity |
| Records manager | DIV / archivist | Archiefwet: records end up in SharePoint and are never destroyed |
| Sustainability coordinator | Green IT / duurzaamheid team | Honest, reportable CO2 figures |
| Operator | DevOps team running the tool | Deploy, monitor and update it reliably |

## Epics

The backlog has 8 epics. E1 and E2 come first: without real sign-in and Graph access no other story can be demonstrated against the real tenant.

| Epic | Goal | Replaces in PoC | Stories |
| --- | --- | --- | --- |
| E1 Sign-in and permissions | Real Teams SSO and Graph access as the signed-in user | `tokenService.js`, simulated SSO | 5 |
| E2 Move shared files to SharePoint | Coach users to move heavily shared OneDrive files to their department site | `graphMock.js` scan + move | 6 |
| E3 Library in OneDrive | One click adds the department library to OneDrive and Explorer | Simulated Verkenner view | 3 |
| E4 Identical copies | Find identical copies and move extras to the recycle bin, reversibly | Recycle-bin flag | 4 |
| E5 Outlook Smart Alert | Suggest a link instead of a large attachment at send time | `outlook.html` | 5 |
| E6 Impact and CO2 | Honest CO2 ranges per person, department and municipality | SQLite stats | 5 |
| E7 Privacy, Archiefwet, audit | Prove compliance to CISO, privacy officer and records manager | DB triggers, retention job | 5 |
| E8 Deployment and operations | Run the tool in Azure, monitored and switchable | Local VM, `start-all.js` | 5 |

## User stories

Each story has a MoSCoW priority. 'Must' stories form the minimum for a pilot with one department.

### E1 Sign-in and permissions

| ID | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| US-1.1 | As a civil servant, I want to be signed in automatically when I open the Groene Coach tab in Teams, so that I never have to log in separately. | Must | Teams SSO gets a token silently; the one-time consent prompt appears only if needed; no password field in the app; no token in localStorage or cookies. |
| US-1.2 | As a tenant admin, I want to grant admin consent for exactly the delegated scopes the tool needs, so that users can start without each one being asked. | Must | App registration lists only User.Read, Files.Read.All, Files.ReadWrite.All and Sites.Read.All (delegated); no application permissions; consent steps documented. |
| US-1.3 | As a civil servant, I want a clear message when admin consent is missing, so that I know it is not something I did wrong. | Must | Banner explains consent is pending; all file actions are disabled; the API answers 403 instead of failing silently. |
| US-1.4 | As a CISO, I want the backend to validate every token and exchange it on-behalf-of the user, so that no forged or stolen token can reach Graph. | Must | Issuer, audience, tenant id and expiry checked against Entra JWKS; OBO tokens kept in memory only and never logged; certificate stored in Key Vault, no client secret in code or config. |
| US-1.5 | As a tenant admin, I want to limit the app to a pilot group, so that we can roll out department by department. | Should | 'Assignment required' on the enterprise app; an unassigned user sees a short explanation, not an error page. |

### E2 Move shared files to SharePoint

| ID | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| US-2.1 | As a civil servant, I want to see which of my OneDrive files are shared with more than 2 people, so that I know which ones belong on SharePoint. | Must | Scans only the signed-in user's own drive via Graph; threshold read from config (default > 2); shows name, number of people and last change; drives with 5,000+ files load page by page. |
| US-2.2 | As a civil servant, I want the tool to suggest my department's SharePoint library, so that I don't have to look for the right place. | Must | Suggestion based on the department in the user's profile and the sites they are a member of; user can pick another site; only sites the user can write to are offered. |
| US-2.3 | As a civil servant, I want to move a file with one click, so that my team works in the shared place from now on. | Must | File moved with Graph, version history kept; colleagues who had access keep it (or are told the new location); on failure the file stays untouched and the reason is shown in plain Dutch. |
| US-2.4 | As a civil servant, I want to choose 'Nu niet', so that I am not nagged about a file I want to keep. | Must | Suggestion hidden for 7 days; file not touched; the snooze record is purged after it expires. |
| US-2.5 | As a civil servant, I want to see why the CO2 saving is a range, so that I trust the numbers. | Should | 'Waarom een bandbreedte?' shows storage, sync and back-up effects with sources; a move shows 0 gram storage saving. |
| US-2.6 | As a civil servant, I want an optional weekly Teams message when new suggestions appear, so that I don't have to remember to open the app. | Could | Off by default; opt-in in settings; at most one message per week; one click to switch off. |

### E3 Library in OneDrive

| ID | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| US-3.1 | As a civil servant, I want to add my department library to my OneDrive with one click ('Toon map in Verkenner'), so that I find the moved files where I always look. | Must | Uses the Graph 'Add shortcut to My files' call; works only for libraries the user can access; success shown with the new folder name. |
| US-3.2 | As a civil servant, I want the button to know the shortcut already exists, so that I don't end up with duplicate folders. | Must | If the shortcut exists the button says 'Al toegevoegd'; no second shortcut is created. |
| US-3.3 | As a civil servant, I want a short explanation of where the folder appears in File Explorer, so that I can find it after syncing. | Should | Explanation with a screenshot; relies on the OneDrive client already installed; nothing extra is installed on the laptop. |

### E4 Identical copies

| ID | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| US-4.1 | As a civil servant, I want to see identical copies of files I own, so that I know what clutter I can clean up. | Must | Copies matched on the Graph content hash (quickXorHash) plus size, never on name alone; shows every location of the copy chain. |
| US-4.2 | As a civil servant, I want to clean up my extra copies only after I confirm, so that nothing disappears without my say. | Must | Dialog names each file and location; only items the user owns are affected; the copy on SharePoint (or the oldest) is always kept; items go to the recycle bin, never permanentDelete. |
| US-4.3 | As a civil servant, I want to undo a clean-up, so that a mistake costs me nothing. | Must | 'Ongedaan maken' in the toast restores at once; a list of cleaned items allows restore for 93 days (recycle-bin period). |
| US-4.4 | As a records manager, I want files with a retention label or legal hold excluded, so that records are never put in the recycle bin. | Must | Items with a retention label, hold or record status are never offered for clean-up; covered by an automated test. |

### E5 Outlook Smart Alert

| ID | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| US-5.1 | As a civil servant, I want a Smart Alert when I send a large attachment to many people, so that I can choose to share a link instead. | Must | Event-based add-in on OnMessageSend with SendMode PromptUser; size and recipient thresholds from config; the check finishes within Outlook's event time limit; works in new Outlook, Outlook on the web and classic Outlook for Windows. |
| US-5.2 | As a civil servant, I want 'Deel als link' to swap the attachment for a sharing link, so that I don't have to do it by hand. | Must | File uploaded to OneDrive (or existing copy reused); link limited to the recipients; attachment removed from the draft; the user reviews before sending. |
| US-5.3 | As a civil servant, I want 'Toch verzenden' always available, so that urgent mail is never blocked. | Must | The button is always shown; one click sends the mail unchanged; choosing it is never counted against the user. |
| US-5.4 | As a tenant admin, I want to deploy the add-in centrally, so that pilot users get it without installing anything. | Must | Deployed via Integrated Apps to a user group; can be removed centrally; no local install. |
| US-5.5 | As a privacy officer, I want the add-in to read only attachment size and recipient count, so that no mail content or addresses leave the mailbox. | Must | Network traffic shows no subject, body or addresses sent to the backend; only the decision is logged, aggregated. |

### E6 Impact and CO2

| ID | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| US-6.1 | As a civil servant, I want to see my own impact as a CO2 range, so that I see my actions add up without being oversold. | Must | Shows low–high range in gram CO2 per year; uses grid mix 0.268 kg/kWh, 0.65 W/TB and PUE 1.185 from the coefficient table; matches the PoC calculator tests. |
| US-6.2 | As a team lead, I want to see my department's total impact, so that I can encourage the team without singling anyone out. | Must | Figures only shown when the department has 3 or more active users; no names or per-person numbers. |
| US-6.3 | As a sustainability coordinator, I want a quarterly municipality-wide export, so that I can include Green IT in the sustainability report. | Should | CSV per department and quarter with ranges and the coefficients used; same k ≥ 3 rule; download limited to an Entra role. |
| US-6.4 | As a sustainability coordinator, I want to update coefficients with a source and date, so that figures stay correct when the grid mix changes. | Should | Admin screen or config change without redeploy; each change stores value, source URL, date and author; old figures keep the coefficients they were calculated with. |
| US-6.5 | As a civil servant, I want everyday comparisons (canal-lamp hours, cooling kWh), so that grams of CO2 mean something to me. | Could | Comparisons derived from the same range; source for each metaphor shown on hover. |

### E7 Privacy, Archiefwet, audit

| ID | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| US-7.1 | As a privacy officer, I want a data inventory and DPIA input, so that I can approve processing before the pilot. | Must | Document lists every data field, purpose, legal basis and retention; only file metadata processed, never file contents. |
| US-7.2 | As a privacy officer, I want personal data purged automatically, so that nothing is kept longer than needed. | Must | Snooze records deleted after 7 days, personal action log after 365 days; daily purge job; purge visible in the operations log. |
| US-7.3 | As a civil servant, I want to see my own action log, so that I know what the tool did on my behalf. | Should | Only the user can see their log; shows date, action and file; no one else, including admins, can open it through the app. |
| US-7.4 | As a records manager, I want proof that the tool cannot permanently delete anything, so that it complies with the Archiefwet. | Must | No code path calls permanentDelete (checked in code review and an automated test); moves keep metadata and version history. |
| US-7.5 | As a CISO, I want security logging without personal data and a pen test before go-live, so that risks are known and traceable. | Must | Logs hold path, status and correlation id, no tokens, names or file names; pen-test findings rated high are fixed before go-live. |

### E8 Deployment and operations

| ID | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| US-8.1 | As an operator, I want CI/CD with infrastructure as code, so that every release is repeatable. | Must | Pipeline runs the tests, builds and deploys to Azure (EU region); Bicep or Terraform for all resources; no manual portal steps. |
| US-8.2 | As an operator, I want separate test, acceptance and production environments, so that changes are tried on a test tenant first. | Should | Test and acceptance use a separate M365 developer tenant; production deploy needs an approval step. |
| US-8.3 | As an operator, I want monitoring and alerts, so that I notice failures before users do. | Must | Application Insights with health check, error rate and Graph latency; alert on more than 5% errors in 15 minutes; telemetry carries no personal data. |
| US-8.4 | As an operator, I want Graph throttling handled, so that the tool keeps working at busy times. | Must | 429 and 503 responses retried with Retry-After and back-off; batch requests where possible; user sees 'probeer het later opnieuw' instead of an error. |
| US-8.5 | As a tenant admin, I want a switch per feature, so that I can turn off a part (for example the Smart Alert) without removing the whole app. | Should | Feature flags for move, copies, Smart Alert and impact; change takes effect within 5 minutes without redeploy. |

## Non-functional stories

These apply to every epic and are part of each story's definition of done.

| ID | Story | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| NF-1 | As a civil servant with a disability, I want the app to be fully accessible, so that I can use it like everyone else. | Must | WCAG 2.1 AA (required for Dutch government); keyboard-only use; screen-reader labels; works in Teams light, dark and high-contrast themes. |
| NF-2 | As a civil servant, I want the app to open quickly, so that it doesn't feel like extra work. | Should | Actie-hub shows first suggestions within 3 seconds for 95% of users; Smart Alert decision within 2 seconds. |
| NF-3 | As a civil servant, I want the app in clear Dutch, so that I understand every message. | Must | All texts in Dutch at B1 level; friendly, non-judgemental tone as in the PoC; no technical error codes shown. |
| NF-4 | As a CISO, I want all data and hosting inside the EU, so that we meet BIO and AVG requirements. | Must | Azure EU region; no third-party CDNs; strict Content Security Policy; dependencies scanned in the pipeline. |
| NF-5 | As an operator, I want 99.5% availability during office hours, so that the Smart Alert never blocks sending. | Must | If the backend is down, Outlook sends normally (fail open); the Teams tab shows a clear 'tijdelijk niet beschikbaar'. |

## Open questions and assumptions

The stories assume the PoC's business rules carry over unchanged. These points still need an owner's answer:

- [ ] Does the municipality allow Files.ReadWrite.All with admin consent, or must the tool use a narrower scope such as Sites.Selected?
- [ ] What happens to existing sharing links when a file moves from OneDrive to SharePoint, and who tells colleagues? (US-2.3)
- [ ] Which Smart Alert thresholds apply in production? The PoC uses a 48.5 MB file to 20 recipients as its example.
- [ ] Is 'department' taken from the Entra profile field, or from a mapping the records manager maintains?
- [ ] Which department runs the pilot, and for how many weeks?
- [ ] Who owns the coefficient table: the sustainability team or IT? (US-6.4)
