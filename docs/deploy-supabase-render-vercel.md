# Deploy: Supabase + Render + Vercel

Teen cheezein, teen alag jagah:

| Kya | Kahan | Kaam |
|---|---|---|
| Database aur files | **Supabase** | PostgreSQL aur private file storage |
| API (backend) | **Render** | NestJS server, `render.yaml` se |
| Web (frontend) | **Vercel** | React app, `vercel.json` se |

> **Status:** is guide ke config files aur code (Supabase file storage, tables ko khule REST API se bachana, build commands) local par test hue hain. **Asli Supabase, Render aur Vercel accounts par ye abhi tak chalaya nahi gaya.** Pehli baar deploy karte waqt neeche ka "Test checklist" zaroor chalayein. Teeno websites apne menu aur naam badalti rehti hain, to buttons ke naam thode alag dikh sakte hain.

Shuru karne se pehle: ek GitHub account chahiye, aur ye code GitHub par ek **private** repo me push hona chahiye (Render aur Vercel wahin se code uthate hain).

```bash
cd valuehub-os
git add -A && git commit -m "ValueHub OS"
git remote add origin https://github.com/<aapka-naam>/valuehub-os.git
git push -u origin main
```

`.env` file git me nahi jaati (`.gitignore` me hai). **Passwords aur keys kabhi commit na karein.**

---

## 1. Supabase (database aur files)

1. supabase.com par account banayein → **New project**.
   - Region: **Singapore** (Render bhi Singapore me hai, to dono paas rahenge).
   - Database password: lamba aur random rakhein, aur kahin likh lein. Agar usme `@`, `:`, `/`, `#` jaise special character hain to connection string me unhe URL-encode karna padega (`@` → `%40`). Aasan: sirf letters aur numbers wala password rakhein.
2. Project ban jaye to upar **Connect** par jayein. Do connection strings chahiye:
   - **Transaction pooler** (port **6543**) → ye `DATABASE_URL` hai. Iske end me ye jodein: `?pgbouncer=true&connection_limit=1`
   - **Session pooler** (port **5432**) → ye `DIRECT_URL` hai. (Direct connection sirf IPv6 par chalti hai, aur Render usse nahi jud sakta. Isliye session pooler lein.)

   Dono kuch aisi dikhti hain: `postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-...pooler.supabase.com:6543/postgres`
3. **Storage** → **New bucket** → naam `valuehub-files` → **Public ko band rakhein (Private)**.
4. **Project Settings → API**:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

   Ye `service_role` key bahut taakatwar hai: ye sirf Render me jayegi. Isse frontend me ya GitHub par kabhi na daalein.

## 2. Render (API)

1. render.com par account banayein → **New → Blueprint** → apna GitHub repo chunein. Render `render.yaml` padh lega.
2. Ye values bharein (yahi sab Render ke **Environment** me dikhengi):

   | Naam | Kya daalein |
   |---|---|
   | `DATABASE_URL` | Supabase ki transaction pooler string (`?pgbouncer=true&connection_limit=1` ke saath) |
   | `DIRECT_URL` | Supabase ki session pooler string |
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
   | `CORS_ORIGINS` | Abhi koi bhi `https://example.com` daal dein; Vercel ka asli address milne ke baad badlenge |
   | `WEB_URL` | Wahi jo `CORS_ORIGINS` hai |
   | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email chahiye to; warna khaali chhod dein |

   `JWT_SECRET` Render khud bana deta hai.
3. **Apply** karein. Pehli baar build me 3 se 5 minute lagte hain. **Logs** me ye dikhna chahiye: migrations apply hue, aur server chalu hua.
4. Browser me `https://<aapka-service>.onrender.com/api/health` kholein. `{"status":"ok",...}` aana chahiye.

`render.yaml` me `plan: starter` hai (chhota paid instance jo jaga rehta hai). Sirf try karne ke liye `free` kar sakte hain, par wo kuch der idle rehne par so jaata hai aur pehli request me lagbhag ek minute leta hai.

## 3. Pehla admin banana

Pehli firm aur admin ek baar banana padta hai. Render me service ke **Shell** tab me (paid instance par milta hai):

```bash
cd apps/valuation-api
SEED_FIRM_NAME='Aapki Firm' SEED_ADMIN_EMAIL='aap@example.com' SEED_ADMIN_PASSWORD='koi-lamba-pakka-password' npm run db:seed:env
```

Password kam se kam 12 characters ka ho. Agar Shell nahi hai to apne laptop se bhi ho sakta hai: repo me `apps/valuation-api` folder me wahi command chalayein, bas pehle `DATABASE_URL=<Supabase session pooler string>` bhi saath me dein.

Phir login karke **Administration** me bank, branches, fee aur users banayein, aur **Report templates** me "Install the standard templates" dabayein.

## 4. Vercel (web)

1. vercel.com par account banayein → **Add New → Project** → wahi GitHub repo.
2. Root Directory khaali (repo ka root) rehne dein. Build ki settings `vercel.json` se aati hain.
3. **Environment Variables** me:
   - `VITE_API_URL` = `https://<aapka-service>.onrender.com/api/v1`
4. **Deploy**. Aapko ek address milega, jaise `https://valuehub-os.vercel.app`.
5. **Wapas Render me jayein** aur `CORS_ORIGINS` aur `WEB_URL` ko is Vercel address se badal dein (aakhir me `/` nahi). Save karne par Render dobara deploy karega.

> Vercel ka free **Hobby** plan sirf personal, non-commercial use ke liye hai. Agar ye kamai ke liye chalana hai to Vercel ka paid plan lena padega (ya Netlify / Cloudflare Pages jaisi jagah dekh lein). Unki shartein apni site par padh lein.

## 5. Test checklist (pehli baar zaroor)

- [ ] Vercel ka address khulta hai aur login page dikhta hai.
- [ ] Admin se login hota hai.
- [ ] Naya assignment banate waqt ek PDF upload karein. Supabase → Storage → `valuehub-files` me ek file dikhni chahiye.
- [ ] Step 2 par us document ko "Read text" karein (pehli baar thoda slow hoga, language data download hota hai).
- [ ] Step 5 par report ka PDF preview khulta hai.
- [ ] Supabase → **Table Editor** me tables ke aage **RLS enabled** likha hai.
- [ ] (Suraksha) Browser se `https://<project-ref>.supabase.co/rest/v1/Firm` bina login ke kholne par data nahi dikhna chahiye (error ya khaali jawab aana chahiye).

## 6. Update kaise karein

Code badal kar GitHub par push karein. Render aur Vercel dono apne aap dobara deploy karte hain, aur nayi database migrations Render ke start par khud lag jaati hain.

## 7. Backup

- **Database:** Supabase ke apne backup ka haal aapke plan par nirbhar karta hai (free aur paid plan me fark hota hai). Unki site par dekh lein, aur zaroorat ho to `deploy/valuehub-os/backup.sh` se `pg_dump` chalaye (`DATABASE_URL` me **session pooler** string dein).
- **Files:** Supabase Storage me hain. `backup.sh` sirf local disk wali files lega, Supabase wali nahi. Files ke liye bucket ka alag backup ya Supabase ka feature use karein.
- **Check:** `npm run verify:files -w apps/valuation-api` har file ka fingerprint dobara jaanchta hai. Ye Supabase wali files ke saath bhi chalta hai (jab `SUPABASE_*` set ho).

## 8. Suraksha ki list

- [ ] `JWT_SECRET` Render ne banaya (apne aap) aur kahin share nahi kiya.
- [ ] Admin ka password pakka hai, aur test users (`ravi.inspector@...`, `anil.valuer@...`) hata diye.
- [ ] `service_role` key sirf Render me hai.
- [ ] `CORS_ORIGINS` me sirf aapka web address hai.
- [ ] Tables par RLS lagi hai (migration `20261102120000_lock_tables_from_rest_api`). Aage koi nayi table banayein to uske migration me bhi RLS lagana zaroori hai; ek test (`migrations-rls.spec.ts`) ye pakadta hai.

## 9. Kuch galat ho to

| Dikkat | Kya karein |
|---|---|
| Browser me "CORS" ya network error | Render me `CORS_ORIGINS` Vercel ke address se bilkul match kare (https, aur aakhir me `/` nahi). |
| `prepared statement ... already exists` | `DATABASE_URL` me `?pgbouncer=true&connection_limit=1` jodein. |
| `Can't reach database server` | `DIRECT_URL` me **session pooler** (port 5432) string dein, direct wali nahi. |
| `password authentication failed` | Password galat, ya usme special character URL-encode nahi hua. |
| Upload par "File storage refused" | Bucket ka naam `valuehub-files` ho, bucket Supabase me bana ho, aur `SUPABASE_SERVICE_ROLE_KEY` sahi ho. |
| Login ke baad turant bahar | Web pehle kisi aur API se jura tha; `VITE_API_URL` sahi karke Vercel ko redeploy karein. |
| Pehli request bahut slow | Render ka free instance so gaya tha; `starter` plan lein. |
| Text padhna (OCR) fail | Pehli baar language data download hota hai; dobara try karein. Scanned PDF jisme text nahi, wo "no text" dikhata hai. |

## Kharcha (andaazan, apni site par dekh lein)

Supabase Pro lagbhag $25 / mahina (free plan me limits hain), Render starter lagbhag $7 / mahina, Vercel Hobby free par non-commercial. Kul chhote setup me $30 se $60 / mahina ke aaspaas. Jaise-jaise users aur files badhein, Supabase aur Render ka size badhana padega.
