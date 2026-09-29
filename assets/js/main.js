/* ============================================================
   The American Ledger — main.js
   Features: live RSS breaking ticker, 2x daily auto-posting,
   search, category filters, dark mode, article renderer + SEO.
   ============================================================ */

/* ---------- US news RSS sources (attached feeds) ---------- */
const RSS_FEEDS = [
  { name: "CNN",        url: "http://rss.cnn.com/rss/cnn_topstories.rss" },
  { name: "Fox News",   url: "https://moxie.foxnews.com/google-publisher/latest.xml" },
  { name: "NPR",        url: "https://feeds.npr.org/1001/rss.xml" },
  { name: "ABC News",   url: "https://abcnews.go.com/abcnews/topstories" },
  { name: "CBS News",   url: "https://www.cbsnews.com/latest/rss/main" },
  { name: "NY Times",   url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" }
];
const RSS2JSON = "https://api.rss2json.com/v1/api.json?rss_url=";
const POSTS_PER_DAY = 2; // auto-publish 2 new posts per day

/* ---------- helpers ---------- */
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const esc = s => (s || "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD (US Eastern)
const fmtFeedDate = iso => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/* ---------- topbar date ---------- */
(function showDate() {
  const el = $("#todayDate");
  if (el) el.textContent = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric" });
})();

/* ---------- dark mode ---------- */
(function theme() {
  const saved = localStorage.getItem("al-theme");
  if (saved === "dark" || (!saved && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.setAttribute("data-theme", "dark");
  const btn = $("#themeToggle");
  if (btn) btn.addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "" : "dark");
    localStorage.setItem("al-theme", dark ? "light" : "dark");
  });
})();

/* ---------- RSS fetching (rss2json public API; CORS-safe) ---------- */
async function fetchFeed(feed) {
  try {
    const res = await fetch(RSS2JSON + encodeURIComponent(feed.url));
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (data.status !== "ok") throw new Error("rss error");
    return (data.items || []).map(it => ({
      title: it.title, link: it.link, source: feed.name,
      desc: (it.description || "").replace(/<[^>]+>/g, "").slice(0, 220),
      pubDate: it.pubDate || it.published || ""
    }));
  } catch (e) { return []; }
}
async function fetchAllItems() {
  const nested = await Promise.all(RSS_FEEDS.map(fetchFeed));
  return nested.flat().filter(i => i.title && i.link);
}

/* ---------- breaking news ticker ---------- */
(async function ticker() {
  const el = $("#tickerText");
  if (!el) return;
  const items = await fetchAllItems();
  if (!items.length) { el.textContent = "Live headline feed unavailable — browse our latest analysis below."; return; }
  const seen = new Set();
  const headlines = items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .filter(i => !seen.has(i.title) && seen.add(i.title))
    .slice(0, 12)
    .map(i => `<a href="${esc(i.link)}" target="_blank" rel="noopener nofollow" style="color:#fff;margin-right:60px"><strong>${esc(i.source)}:</strong> ${esc(i.title)}</a>`);
  el.innerHTML = headlines.join(" · ");
})();

/* ---------- AUTO-POST: 2 new posts per day ---------- */
(async function autoPost() {
  const grid = $("#autopostGrid");
  if (!grid) return;
  const key = "al-autopost-" + todayKey();
  const cached = localStorage.getItem(key);

  const render = posts => {
    if (!posts.length) {
      grid.innerHTML = `<div class="autopost-loading">No new wire posts yet today — check back soon, or read our latest features below.</div>`;
      return;
    }
    grid.innerHTML = posts.map((p, i) => `
      <article class="autopost-card">
        <span class="autopost-badge">⚡ Auto-Posted #${i + 1} · ${todayKey()}</span>
        <h3><a href="${esc(p.link)}" target="_blank" rel="noopener nofollow">${esc(p.title)}</a></h3>
        <p style="font-size:.88rem;color:var(--muted)">${esc(p.desc)}…</p>
        <div class="autopost-meta">
          <span class="autopost-src">${esc(p.source)}</span>
          <time>${fmtFeedDate(p.pubDate)} ET</time>
        </div>
      </article>`).join("");
  };

  if (cached) { render(JSON.parse(cached)); return; } // already published today

  const items = await fetchAllItems();
  if (!items.length) { render([]); return; }
  const startOfToday = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  startOfToday.setHours(0, 0, 0, 0);
  const fresh = items.filter(i => new Date(i.pubDate) >= startOfToday)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  // publish exactly 2 newest items of the day (fallback: 2 newest overall)
  const posts = (fresh.length >= POSTS_PER_DAY ? fresh : items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))).slice(0, POSTS_PER_DAY);
  render(posts);
  try { localStorage.setItem(key, JSON.stringify(posts)); } catch (e) {}
})();

/* ---------- search + category filter (homepage) ---------- */
(function filters() {
  const grid = $("#articleGrid");
  if (!grid) return;
  const cards = $$(".card", grid);
  const chips = $$("#filterChips .chip");
  const input = $("#searchInput");
  const none = $("#noResults");
  let cat = "all", q = "";

  const params = new URLSearchParams(location.search);
  if (params.get("cat")) { cat = params.get("cat"); chips.forEach(c => c.classList.toggle("active", c.dataset.filter === cat)); }
  if (params.get("q") && input) { q = params.get("q").toLowerCase(); input.value = q; }

  const apply = () => {
    let visible = 0;
    cards.forEach(c => {
      const ok = (cat === "all" || c.dataset.category === cat) && (!q || c.dataset.title.includes(q));
      c.style.display = ok ? "" : "none";
      if (ok) visible++;
    });
    if (none) none.hidden = visible > 0;
  };
  chips.forEach(c => c.addEventListener("click", () => {
    chips.forEach(x => x.classList.remove("active"));
    c.classList.add("active");
    cat = c.dataset.filter;
    apply();
  }));
  if (input) input.addEventListener("input", () => { q = input.value.trim().toLowerCase(); apply(); });
  apply();
})();

/* ---------- newsletter (demo) ---------- */
(function newsletter() {
  const form = $("#newsletterForm");
  if (!form) return;
  form.addEventListener("submit", e => {
    e.preventDefault();
    const email = form.querySelector("input").value;
    localStorage.setItem("al-newsletter", email);
    form.innerHTML = `<p style="color:#fff;font-weight:600">✓ You're on the list! First edition arrives tomorrow morning.</p>`;
  });
})();

/* ---------- article renderer (article.html) + dynamic SEO ---------- */
(function articlePage() {
  const body = $("#articleBody");
  if (!body || typeof ARTICLES === "undefined") return;
  const id = new URLSearchParams(location.search).get("id");
  const a = ARTICLES.find(x => x.id === id) || ARTICLES[0];
  const fmt = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const abs = p => SITE_INFO.url + "/" + p;

  document.title = a.title + " — " + SITE_INFO.name;
  const setMeta = (sel, val) => { const m = document.querySelector(sel); if (m && val) m.setAttribute("content", val); };
  setMeta('meta[name="description"]', a.meta_desc);
  setMeta('meta[property="og:title"]', a.title);
  setMeta('meta[property="og:description"]', a.meta_desc);
  setMeta('meta[property="og:url"]', abs("article.html?id=" + a.id));
  setMeta('meta[property="og:image"]', abs(a.image));
  setMeta('meta[name="twitter:title"]', a.title);
  setMeta('meta[name="twitter:description"]', a.meta_desc);
  setMeta('meta[name="twitter:image"]', abs(a.image));
  const can = document.querySelector('link[rel="canonical"]');
  if (can) can.href = abs("article.html?id=" + a.id);

  const crumbCat = $("#crumbCat"), crumbTitle = $("#crumbTitle");
  if (crumbCat) { crumbCat.textContent = a.category; crumbCat.href = "index.html?cat=" + encodeURIComponent(a.category); }
  if (crumbTitle) crumbTitle.textContent = a.title.slice(0, 60) + "…";

  body.innerHTML = `
    <span class="card-cat" style="position:static;display:inline-block">${esc(a.category)}</span>
    <h1>${esc(a.title)}</h1>
    <div class="article-meta">
      <span class="author">By ${esc(a.author)}</span>
      <time datetime="${a.date}">${fmt(a.date)}</time>
      <span>· ${a.body.replace(/<[^>]+>/g, " ").split(/\s+/).length} min read</span>
    </div>
    <img class="featured-img" src="${a.image}" alt="${esc(a.image_alt)}" width="1200" height="675">
    ${a.body}
    <div class="article-tags">${a.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join("")}</div>
    <div class="share-row">Share:
      <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(a.title)}&url=${encodeURIComponent(abs("article.html?id=" + a.id))}" target="_blank" rel="noopener">Twitter/X</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(abs("article.html?id=" + a.id))}" target="_blank" rel="noopener">Facebook</a>
      <a href="mailto:?subject=${encodeURIComponent(a.title)}&body=${encodeURIComponent(abs("article.html?id=" + a.id))}">Email</a>
    </div>`;

  // JSON-LD structured data for SEO
  const ld = {
    "@context": "https://schema.org", "@type": "NewsArticle",
    "headline": a.title, "description": a.meta_desc, "image": [abs(a.image)],
    "datePublished": a.date + "T08:00:00-04:00", "dateModified": a.date + "T08:00:00-04:00",
    "author": { "@type": "Person", "name": a.author },
    "publisher": { "@type": "Organization", "name": SITE_INFO.name, "logo": { "@type": "ImageObject", "url": abs("assets/images/logo.png") } },
    "mainEntityOfPage": { "@type": "WebPage", "@id": abs("article.html?id=" + a.id) },
    "articleSection": a.category, "keywords": a.tags.join(", ")
  };
  const s = document.createElement("script");
  s.type = "application/ld+json";
  s.textContent = JSON.stringify(ld);
  document.head.appendChild(s);

  // related articles sidebar
  const rel = $("#relatedArticles");
  if (rel) {
    const related = ARTICLES.filter(x => x.id !== a.id)
      .sort((x, y) => (y.category === a.category) - (x.category === a.category)).slice(0, 5);
    rel.innerHTML = related.map(r => `
      <a class="related-item" href="article.html?id=${r.id}">
        <img src="${r.image}" alt="${esc(r.image_alt)}" loading="lazy" width="84" height="60">
        <div><h4>${esc(r.title)}</h4><span>${esc(r.category)} · ${fmt(r.date)}</span></div>
      </a>`).join("");
  }
})();
