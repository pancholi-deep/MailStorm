"""Rebuild the code-verified architecture poster. Requires Pillow (diagram tooling only)."""
from pathlib import Path
from html import escape
import math
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
W = 3000
REG = '/System/Library/Fonts/Supplemental/Arial.ttf'
BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
if not Path(REG).exists():
    REG, BOLD = 'DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'
fonts = {}
def font(size, bold=False):
    return fonts.setdefault((size,bold), ImageFont.truetype(BOLD if bold else REG, size))

# These are observations of the code, not claims that the referenced authors designed this repository.
sections = [
('01  Browser & existing UI', 'frontend/src/components/EmailForm.jsx', 'blue', [
'React 19 • React Router 7 • Tailwind • React Scripts.',
'Login, protected email form, legacy callback redirect, and privacy page.',
'CSV drag/drop; TXT or HTML template; Process Files; manual plain-text composition.',
'Subject/body editing, Send, Cancel, Reset, dark mode, Sign Out, Download Logs.',
'AuthContext + session.js hold profile and opaque app session in sessionStorage.',
'useEmailSending resumes a running job on mount; only the newest 500 log messages stay visible.',
'Reset forgets the batch identity and permits an intentional new send.' ]),
('02  Sign-in & provider credentials', 'backend/routes/auth_routes.py; jobs/crypto.py', 'purple', [
'Google popup code flow → POST /auth/google {code}.',
'Origin allowlist + X-Requested-With verification; code length 1–4,096.',
'Code exchange runs in a thread; Google userinfo supplies the verified account identity.',
'Owner = SHA-256(Google sub). Existing refresh token is retained if Google omits a new one.',
'Fernet encrypts provider tokens, expiry, name and email on the server.',
'Browser receives a separate random app token; DB stores its SHA-256 hash; default lifetime 7 days.',
'Reauthentication requeues awaiting_auth campaigns; logout revokes the current app session.' ]),
('03  API boundary & request protection', 'backend/main.py; core/request_limits.py', 'blue', [
'FastAPI / Uvicorn; Pydantic request validation; CORS permits configured origins and GET/POST/PUT.',
'Protected routes resolve owner before reading request bodies. Queries also check object ownership.',
'ASGI middleware counts incoming bytes without buffering the whole upload.',
'Content-Length rejection, receive deadline 120 s, and at most 8 active POST/PUT requests per API process.',
'Body caps depend on route; CSV exact size and content limits are enforced separately.',
'413 oversized • 408 timeout • 429 busy/full • 401 expired session • 404 inaccessible object.',
'Responses use Cache-Control: no-store and X-Content-Type-Options: nosniff.' ]),
('04  Upload API — reserve, transfer, seal', 'backend/routes/campaign_routes.py', 'teal', [
'POST /v1/uploads {size, sha256} → 201 with upload ID and transfer target.',
'Local: PUT /v1/uploads/{id}/content; streaming write, exclusive file creation, checksum verification.',
'Production: browser POSTs file directly to a signed S3 URL, with no app bearer token sent to S3.',
'POST /v1/uploads/{id}/complete → seal once; repeated completion returns the same ID.',
'Local states: reserved → receiving → received → finalizing → uploaded.',
'S3 states: reserved → finalizing → uploaded. Transitions require matching owner/state and age <15 min.',
'Failed uploads require a new reservation. Admission: 20 uploads/owner/hour; 2,000 total/hour by default.' ]),
('05  Campaign command API', 'backend/routes/campaign_routes.py; jobs/store.py', 'blue', [
'POST /v1/campaigns {upload_id, subject, body, is_html} → 202 with durable campaign status.',
'UUID Idempotency-Key required. DB unique(owner, key) makes creation atomic.',
'Fingerprint = SHA-256(upload checksum + template). Same key/content returns existing ID; changed content → 409.',
'POST /v1/campaigns/{id}/cancel sets a durable flag. An in-flight message may still finish.',
'POST /v1/campaigns/{id}/retry continues pending/retry rows; invalid inputs require a new campaign.',
'POST /send-emails keeps legacy multipart field names but returns 202 JSON, not the old SSE stream.',
'Queue-full responses use 429 + Retry-After: 30.' ]),
('06  Read API, logs & health', 'backend/routes/campaign_routes.py; main.py', 'blue', [
'GET /v1/campaigns → latest 50 campaigns for the current owner.',
'GET /v1/campaigns/{id} → state, total, accepted/failed/unknown counts, cancellation flag and timestamps.',
'GET /v1/campaigns/{id}/recipients?after=0&limit=100; row-number cursor; maximum page size 250.',
'GET /v1/campaigns/{id}/logs streams CSV in 250-row pages and escapes spreadsheet formula prefixes.',
'POST /v1/logout revokes the caller’s session.',
'GET /ping is liveness; GET /readyz verifies DB connectivity and schema version.',
'Readiness does not verify worker liveness, S3 access, or Gmail availability.' ]),
('07  Object storage & trust boundary', 'backend/storage/objects.py', 'teal', [
'Development: private directory under STORAGE_DIR/uploads; original CSV is a local file.',
'Production: boto3 S3 client; private bucket supplied by the operator; signed POST valid for 900 s.',
'Signed policy binds object size and AES256 server-side encryption.',
'HEAD checks size; conditional COPY captures the ETag snapshot from incoming/{id} to sealed/{id}.',
'Browser can overwrite only its incoming target; worker reads the sealed object.',
'S3 checksum is validated by the importer before any sending.',
'Storage client: 5 s connect, 30 s read, bounded retries. Cleanup checks per-object deletion errors.' ]),
('08  Database — identity & campaign data', 'backend/jobs/database.py', 'teal', [
'SQLAlchemy Core + psycopg/PostgreSQL in production; SQLite for local development.',
'job_connections: hashed owner PK, encrypted Google credentials/profile, version, sender next_at.',
'job_sessions: hashed token PK, owner FK, expiry.',
'job_uploads: ID, owner, size, SHA-256, state, created time; object_version is currently unused.',
'job_campaigns: owner FK + upload FK, idempotency key/fingerprint, encrypted template, state and imported flag.',
'Campaign fields also hold counters, cancel flag, lease owner, generation, lease expiry, next_at and error.',
'Only requested status columns are fetched for status/list APIs; encrypted template is omitted.' ]),
('09  Database — queue, attempts & indexes', 'backend/jobs/database.py; jobs/store.py', 'teal', [
'job_recipients: PK(campaign, row_no), encrypted name/email, state, attempt count, provider ID and error.',
'job_attempts: attempt ID, campaign FK, row number, state, provider ID, error and creation time.',
'Campaign deletion cascades to recipients and attempts.',
'job_scheduler: singleton row holding project next_at and the shared transaction lock.',
'job_schema: initial version 1. Migration creates job_* tables; startup verifies the version.',
'Indexes cover owner/key uniqueness, due jobs, owner leases, recipient state/row, retention and session/upload lookup.',
'PostgreSQL pool: 8 connections + 8 overflow per process, 5 s pool timeout; pre-ping enabled.' ]),
('10  Import & whole-file validation', 'backend/jobs/importer.py; utils/validation.py', 'teal', [
'Worker streams UTF-8/BOM CSV through a 64 KiB limited reader; recomputes size and SHA-256.',
'At most 32 unique normalized columns; name + email required; blank rows skipped.',
'Quoted CSV supported; malformed rows/encoding, unsafe names or invalid addresses reject the campaign.',
'First name is used for personalization; supported placeholders are {name} and {email}.',
'Unknown placeholders and unsafe/oversized subjects rejected; HTML inserted values are escaped.',
'Expanded body limits checked without building every full message.',
'Encrypted recipient rows written in chunks of 250. Sending starts only after the entire import succeeds.' ]),
('11  Worker scheduling & fenced leases', 'backend/jobs/worker.py; jobs/store.py', 'purple', [
'Dedicated asyncio worker uses a UUID identity; idle polling interval up to 0.5 s.',
'Claim oldest eligible due campaign; one leased campaign per owner; at most 8 across all workers.',
'Each claim increments generation. Lease lasts 120 s; heartbeat every 40 s.',
'Worker mutations verify campaign ID, worker ID, generation and live lease; stale writes raise LostLease.',
'Expired leases recovered in groups of 50; unfinished submitting rows become unknown.',
'One import or one recipient attempt per claim; release schedules the next opportunity.',
'SIGTERM/SIGINT stops new claims and allows the current operation to finish.' ]),
('12  Sending, timeouts & outcomes', 'backend/utils/email_utils.py; jobs/worker.py', 'purple', [
'Refresh Google access token when expiry is within 60 s; version check prevents overwriting a newer login.',
'Record recipient + attempt as submitting before contacting Gmail.',
'Personalize; build UTF-8 MIME EmailMessage in a thread; base64url encode; httpx POST to Gmail messages.send.',
'Default send deadline 30 s. Success stores provider message ID and increments accepted count.',
'Connect/pool failures and explicit rate-limit rejection can retry; max 5 attempts; exponential delay + jitter.',
'Read/write uncertainty and 5xx become unknown; provider errors can pause the campaign.',
'401 → awaiting_auth; non-rate 403 → blocked; definitive rejection → permanently_failed.' ]),
('13  State model & duplicate semantics', 'backend/jobs/store.py; jobs/worker.py', 'purple', [
'Campaign happy path: importing → queued → running → queued … → complete.',
'Other campaign states: retry_wait, awaiting_auth, blocked, invalid and cancelled.',
'Recipient path: pending/retry_wait → submitting → accepted, retry_wait, permanently_failed or unknown.',
'Retry and lease recovery never automatically replay accepted or unknown recipients.',
'Explicit ambiguous provider errors pause; crash recovery can continue other unsent recipients.',
'Unique campaign creation prevents duplicate jobs for one key; it is not a Gmail idempotency guarantee.',
'Fencing protects DB writes only. Gmail cannot enforce the generation. Accepted is not inbox delivery; exactly-once is not guaranteed.' ]),
('14  Limits, pacing & backpressure', 'backend/core/config.py; jobs/store.py', 'orange', [
'Default input: CSV 2 MiB / 500 recipients; subject 998 characters; body 1,000,000 characters.',
'Active queue caps: 10 campaigns per owner, 1,000 overall. Configurable limits need staging validation.',
'DB timestamps share sender pacing (1.1 s) and project pacing (0.01 s) across worker processes.',
'Rate-limit responses defer the sender; project rate-limit reason can defer the project.',
'Retry-After supports seconds/date; delay is capped at 24 h. Account daily quotas still apply.',
'PostgreSQL clock supplies scheduling/lease time; SQLite uses local time.',
'No network or file parsing inside DB transactions; the global scheduler lock still limits write throughput.' ]),
('15  Frontend data & progress behavior', 'frontend/src/utils/emailApi.js; hooks/useEmailSending.js', 'blue', [
'Papa Parse processes CSV in 256 KiB chunks; preview validation retains at most 500 recipients.',
'Incremental SHA-256 hashes file slices; browser stores batch fingerprint + UUID for 24 h in sessionStorage.',
'Send flow: reserve → transfer → seal → create → poll. Status normally polls every 1 s.',
'Result cursor advances over terminal recipient rows. Transient polling failures back off up to 30 s, with 6 retries.',
'API fetch deadline 45 s; local PUT 120 s. Direct S3 upload relies on its supplied abort signal.',
'Unmount aborts observation; server work continues. Cancel explicitly calls the server.',
'CSV export is streamed by the API but collected as a Blob in the browser; very large downloads still use browser memory.' ]),
('16  Retention & data security', 'backend/jobs/crypto.py; jobs/store.py', 'purple', [
'Fernet encrypts recipient data, templates and Google credentials; session tokens are hashed.',
'Client secret and encryption key stay server-side. Browser app token remains accessible to same-origin scripts.',
'Production requires HTTPS frontend origins, PostgreSQL, S3 and a shared encryption key.',
'Development generates a private encryption.key file; keep it with the DB and outside Git.',
'Worker cleanup runs roughly every 60 s. Terminal/paused campaigns expire after 30 days by default.',
'Per pass: up to 25 campaigns, 1,000 sessions and 250 orphan uploads. Active campaigns stay.',
'Unreferenced uploads age out after 1 h; objects are deleted before upload metadata. Idle credentials expire once no job/session references them.' ]),
('17  Runtime & deployment topology', 'backend/main.py; render.yaml; .env.example files', 'orange', [
'Local: one API process + embedded worker, SQLite, local files; schema created at startup.',
'Production: separate API and worker processes share PostgreSQL, S3 configuration and the same encryption key.',
'API lifespan creates shared httpx client, Store and Objects; worker uses its own client/process.',
'Run python -m backend.jobs.migrate before production startup; then python -m backend.jobs.worker.',
'Render blueprint defines paid API, worker and database; frontend hosted separately.',
'Configure DATABASE_URL, CREDENTIAL_ENCRYPTION_KEY, S3_BUCKET/AWS identity and Google OAuth secrets.',
'S3 bucket, CORS, TLS proxy, backups, key rotation and alerts require operator provisioning.' ]),
('18  Evidence, compatibility & known gaps', '.github/workflows/ci.yml; backend/tests; frontend/src/*.test.*', 'orange', [
'Latest local checks: 37 backend + 40 frontend tests passed; build and privacy sync passed.',
'10,000-row late-error test confirms 250-row imports and zero sends before full validation.',
'Tests cover ownership, duplicate creation, lease takeover, recovery, quota deferral, refresh and UI workflows.',
'PostgreSQL integration is wired to a CI service but was skipped locally; S3 tests use mocks.',
'No live Gmail/S3 capacity certification. Edge rate limits, worker-health monitoring and dashboards are not provisioned.',
'Legacy batch_store.py is not the current send path. Old hash-only checkpoints cannot reconstruct durable jobs.',
'Drain/reconcile legacy sends, migrate, deploy API + UI together and sign in again. No Redis, Celery, Kafka or WebSocket layer is used.' ]),
]
refs = [
('R1  Asynchronous request/reply', 'https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply', '202 returns a durable ID; the browser polls status while workers run independently. Map: campaign_routes.py + emailApi.js.'),
('R2  Queue-based load leveling', 'https://learn.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling', 'Durable DB jobs absorb requests; bounded worker claims, admission caps and pacing control processing. Map: Store.create / claim.'),
('R3  Idempotent API requests', 'https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/', 'A caller key and content fingerprint protect campaign creation from duplicate requests. Scope ends before the external Gmail side effect. Map: Store.create.'),
('R4  Timeouts, backoff & jitter', 'https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/', 'Deadlines, bounded retries, exponential delay and random jitter limit retry amplification. Only safe outcomes are retried. Map: worker.py + email_utils.py.'),
('R5  Fencing stale workers', 'https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html', 'Increasing generations plus a live lease reject stale DB mutations. Gmail calls are outside the fence. Map: Store.claim / fenced / outcome.'),
('R6  Cryptographic storage', 'https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html', 'Sensitive payloads use authenticated encryption; production keys are supplied separately. Key management and rotation remain operator duties. Map: Vault + config.py.'),
]

# Draw identical text and geometry to SVG and raster for a searchable, zoomable original plus PNG.
ops=[]
def rect(x,y,w,h,fill,stroke=None,r=18): ops.append(('rect',x,y,w,h,fill,stroke,r))
def text(x,y,value,size=28,color='#26354b',bold=False,link=None): ops.append(('text',x,y,value,size,color,bold,link))
def line(points,color='#8ea0b5',width=4,arrow=False): ops.append(('line',points,color,width,arrow))
def wrap(value,width,size=28,bold=False):
    result=[]; current=''
    for word in value.split():
        proposed=(current+' '+word).strip()
        if font(size,bold).getlength(proposed)>width and current:
            result.append(current);current=word
        else: current=proposed
    if current: result.append(current)
    return result
colors={'blue':'#245cba','teal':'#087d7e','purple':'#7254ba','orange':'#ac631d'}
text(80,62,'MAILSTORM',72,'#122b49',True)
text(80,153,'Architecture atlas  /  implemented repository design',38,'#476078')
text(80,212,'READ TOP → BOTTOM   •   Flow → API details → data & workers → safeguards → references',25,'#536b81')
text(2340,82,'CODE SNAPSHOT',25,'#476078',True)
text(2340,122,'13 OCTOBER 2026',30,'#122b49',True)

labels=[('BROWSER','React UI','Compose, upload, follow progress','blue'),('API','FastAPI','Authenticate, validate, persist','blue'),('DATABASE','PostgreSQL','Campaign queue + checkpoints','teal'),('WORKER','Async process','Claim, import, pace, send','purple'),('PROVIDER','Google Gmail','Accept MIME message','orange')]
for i,(tag,title,desc,c) in enumerate(labels):
    x=80+i*580
    rect(x,285,520,182,'#ffffff','#d7e1eb')
    text(x+24,307,tag,23,colors[c],True)
    text(x+24,347,title,40,'#122b49',True)
    for j,t in enumerate(wrap(desc,470,25)):text(x+24,405+j*30,t,25)
    if i<4:line([(x+527,375),(x+567,375)],colors[c],5,True)
text(80,493,'1  Submit with an app session',25,'#245cba',True)
text(1240,493,'2  Persist before processing',25,'#087d7e',True)
text(2400,493,'3  Checkpoint every attempt',25,'#ac631d',True)
for x,w,title,body,c in [
(80,890,'GOOGLE OAUTH','Browser popup → API code exchange + userinfo. Worker refreshes tokens server-side. Google credentials never become the browser app session.','purple'),
(1000,950,'PRIVATE OBJECT STORAGE','Browser → signed S3 incoming object. API → sealed snapshot. Worker ← streamed CSV. Development uses API PUT + local files.','teal'),
(1980,940,'PROGRESS RETURNS THROUGH THE API','Worker ↔ database for claims and outcomes. Browser ← status/result polling. Closing the tab does not stop the job; Cancel requests it explicitly.','blue')]:
    rect(x,552,w,188,'#eaf0f6')
    text(x+24,577,title,25,colors[c],True)
    for j,t in enumerate(wrap(body,w-48,27)):text(x+24,620+j*32,t,27)
text(80,777,'PRODUCTION PATH ABOVE   •   LOCAL SWAP: SQLite + local files + embedded worker   •   Arrows show logical flow, not a separate message broker.',24,'#536b81')

y=852
for row in range(6):
    group=sections[row*3:row*3+3]
    layouts=[]
    for title,source,c,bullets in group:
        lines=[]
        for item in bullets:
            wrapped=wrap(item,842,28)
            lines.extend([(t,i==0) for i,t in enumerate(wrapped)])
            lines.append(('',False))
        layouts.append(lines)
    h=max(len(ls)*34 for ls in layouts)+135
    for col,((title,source,c,bullets),ls) in enumerate(zip(group,layouts)):
        x=80+col*956
        rect(x,y,928,h,'#ffffff','#d7e1eb')
        rect(x,y,928,8,colors[c],r=0)
        text(x+28,y+32,title,33,colors[c],True)
        cy=y+93
        for t,first in ls:
            if t:
                if first:rect(x+30,cy+12,7,7,colors[c],r=2)
                text(x+50,cy,t,28)
            cy+=34
        # Source location is kept separate from content and remains selectable in SVG.
        text(x+28,y+h-37,source,21,'#6b7b8d')
    y+=h+28
text(80,y+20,'SYSTEM DESIGN REFERENCES',42,'#122b49',True)
text(80,y+82,'These are pattern mappings from the code review, not claims of full compliance or evidence that the repository authors cited these sources.',26,'#536b81')
y+=145
for row in range(2):
    group=refs[row*3:row*3+3]
    hs=[]
    for title,url,body in group:hs.append(len(wrap(body,866,27))*33+157)
    h=max(hs)
    for col,(title,url,body) in enumerate(group):
        x=80+col*956
        rect(x,y,928,h,'#e8f0f7')
        text(x+28,y+28,title,32,'#245cba',True,url)
        for j,t in enumerate(wrap(body,866,27)):text(x+28,y+81+j*33,t,27)
        text(x+28,y+h-43,'Open source reference ↗  (click in SVG / HTML)',23,'#245cba',False,url)
    y+=h+24
text(80,y+25,'HOW TO USE THIS POSTER',28,'#122b49',True)
text(80,y+70,'Zoom into the SVG for selectable text and reference links. The PNG is suitable for sharing. A companion HTML viewer includes all reference URLs.',26,'#536b81')
text(80,y+115,'Defaults describe this snapshot. Production capacity, Google account quotas and infrastructure readiness must be verified in the deployment environment.',26,'#536b81')
H=y+185
im=Image.new('RGB',(W,H),'#f3f6fa'); draw=ImageDraw.Draw(im)
svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">', '<title>MailStorm detailed architecture atlas</title>', '<desc>Implemented architecture, route inventory, database schema, worker recovery, security, deployment, limits and system design references.</desc>',f'<rect width="{W}" height="{H}" fill="#f3f6fa"/>']
for op in ops:
    if op[0]=='rect':
        _,x,yy,w,h,fill,stroke,r=op
        draw.rounded_rectangle((x,yy,x+w,yy+h),radius=r,fill=fill,outline=stroke,width=2)
        svg.append(f'<rect x="{x}" y="{yy}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke or "none"}" stroke-width="2"/>')
    elif op[0]=='text':
        _,x,yy,value,size,color,bold,link=op
        assert x+font(size,bold).getlength(value)<W-40,(value,'overflows page')
        draw.text((x,yy),value,font=font(size,bold),fill=color,anchor='lt')
        node=f'<text x="{x}" y="{yy+size*.80}" font-family="Arial,Helvetica,sans-serif" font-size="{size}" font-weight="{700 if bold else 400}" fill="{color}">{escape(value)}</text>'
        svg.append(f'<a href="{escape(link)}" target="_blank">{node}</a>' if link else node)
    elif op[0]=='line':
        _,points,color,width,arrow=op
        draw.line(points,fill=color,width=width)
        svg.append(f'<polyline points="{" ".join(f"{x},{yy}" for x,yy in points)}" fill="none" stroke="{color}" stroke-width="{width}"/>')
        if arrow:
            x,yy=points[-1]; verts=[(x,yy),(x-13,yy-9),(x-13,yy+9)]
            draw.polygon(verts,fill=color)
            svg.append(f'<polygon points="{" ".join(f"{a},{b}" for a,b in verts)}" fill="{color}"/>')
svg.append('</svg>')
(OUT/'mailstorm-architecture.svg').write_text('\n'.join(svg))
im.save(OUT/'mailstorm-architecture.png',optimize=True)
preview=im.copy();preview.thumbnail((1200,2400));preview.save(OUT/'mailstorm-architecture-preview.png')
links=''.join(f'<li><a href="{escape(url)}">{escape(title)}</a><p>{escape(body)}</p></li>' for title,url,body in refs)
(OUT/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MailStorm architecture atlas</title><style>body{font:16px system-ui;margin:0;background:#f3f6fa;color:#122b49}header,section{max-width:1100px;margin:auto;padding:24px}a{color:#245cba}nav{display:flex;gap:20px;align-items:center;flex-wrap:wrap}#viewport{overflow:auto;height:78vh;border-block:1px solid #ccd6e0;background:#dce5ed}object{display:block;width:100%;min-width:900px}button{padding:10px 16px;background:white;border:1px solid #aabbcc;border-radius:8px;cursor:pointer}li{margin:20px 0}p{line-height:1.6}</style><header><h1>MailStorm architecture atlas</h1><p>Code-verified snapshot: 13 October 2026. Follow the main flow, then explore 18 detail panels and six design references. This is a code map, not a production capacity certification.</p><nav><button onclick="resize(.8)">− Zoom out</button><button onclick="resize(1.25)">+ Zoom in</button><button onclick="document.querySelector('object').style.width='100%'">Fit width</button><a href="mailstorm-architecture.png" download>Download PNG</a><a href="mailstorm-architecture.svg" target="_blank">Open SVG at full resolution</a></nav></header><main id="viewport"><object data="mailstorm-architecture.svg" type="image/svg+xml" aria-label="Detailed MailStorm architecture"><img src="mailstorm-architecture.png" alt="MailStorm architecture poster"></object></main><section><h2>Pattern references</h2><p>These sources explain the patterns mapped to the code. They do not imply that every recommendation in each source has been implemented.</p><ol>'''+links+'''</ol><p>Repository evidence: backend/routes, backend/jobs, backend/storage, backend/core, frontend/src/hooks, frontend/src/utils, render.yaml and .github/workflows/ci.yml. No credentials are included.</p></section><script>function resize(f){const e=document.querySelector('object');e.style.width=Math.max(900,e.getBoundingClientRect().width*f)+'px'}</script></html>''')
print(f'Generated {W} x {H} PNG, SVG, preview and HTML viewer in {OUT}')
